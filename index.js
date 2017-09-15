import fetch from 'isomorphic-fetch'
import ical from 'ical.js'
import moment from 'moment'
import compromise from 'compromise'
import natural from 'natural'
import { WORKSPACE, PERSONAL_API_TOKEN, DEFAULT_PROJECT, ICAL } from 'dotenv'

const token = new Buffer(`${PERSONAL_API_TOKEN}:api_token`).toString('base64')
const time = process.argv.slice(2).join(' ') || 'today'
const defaultProject = parseInt(DEFAULT_PROJECT)

const toggl = async (method, endpoint, data = false) => {
  const body = JSON.stringify(data)
  const url = `https://www.toggl.com/api/v8/${endpoint}`
  const json = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'authorization': `Basic ${token}`
    },
    body
  })
  return await json.text()
}

const findProject = (projects, summary) => {
  const bits = summary.split(':')
  const found = projects.find(({ name }) => {
    if (name === bits[0]) {
      return true
    } else if (natural.JaroWinklerDistance(bits[0], name) >= 0.8) {
      return true
    }
    return false
  })
  if (found) {
    return found.id
  }
  return false
}

(async () => {
  let dateCheck = []
  let dateAdd = []

  console.log('> Getting projects')
  const projects = JSON.parse(
    await toggl('GET', `workspaces/${WORKSPACE}/projects`)
  )
  console.log('> Projects:')
  projects.map(({ id, name }) => console.log('>>', id, name))

  console.log('> Building list of dates to look at')
  const when = compromise(time).dates().data()
  for (const x of when) {
    if (x.date) {
      const { month, date, weekday, year, named, time } = x.date
      if (named === 'today') {
        dateCheck.push({
          from: moment().startOf('day'),
          to: moment().endOf('day')
        })
      } else if (named === 'yesterday') {
        dateCheck.push({
          from: moment().subtract(1, 'day').startOf('day'),
          to: moment().subtract(1, 'day').endOf('day')
        })
      } else if (named === 'tomorrow') {
        dateCheck.push({
          from: moment().add(1, 'day').startOf('day'),
          to: moment().add(1, 'day').endOf('day')
        })
      } else if (month || date) {
        const now = moment().set({ month, date })
        dateCheck.push({
          from: moment(now).startOf('day'),
          to: moment(now).endOf('day')
        })
      }
    }
  }
  dateCheck.map(({ from, to }) =>
    console.log('>>', 'from:', from.calendar(), 'to:', to.calendar())
  )

  console.log('>', ICAL)
  const data = await fetch(ICAL).then(d => d.text())
  const cal = ical.parse(data)
  const comp = new ical.Component(cal)
  const events = comp.getAllSubcomponents('vevent')
  for (const event of events) {
    const summary = event.getFirstPropertyValue('summary')
    const start = moment(new Date(event.getFirstPropertyValue('dtstart')))
    const end = moment(new Date(event.getFirstPropertyValue('dtend')))
    for (const date of dateCheck) {
      if (
        start.isBetween(date.from, date.to) &&
        end.isBetween(date.from, date.to)
      ) {
        const project = findProject(projects, summary) || defaultProject
        dateAdd.push({
          description: summary,
          created_with: 'API',
          start: start.format(),
          duration: end.diff(start, 'seconds'),
          pid: project,
          billable: project !== defaultProject
        })
      }
    }
  }

  for (const date of dateAdd) {
    await toggl('POST', 'time_entries', {
      time_entry: date
    })
    console.log('>> Added', date)
  }

  console.log('> Done')
})()
