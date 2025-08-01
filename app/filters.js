const govukPrototypeKit = require('govuk-prototype-kit')
const addFilter = govukPrototypeKit.views.addFilter

const marked = require('marked')
const { gfmHeadingId } = require('marked-gfm-heading-id')
const numeral = require('numeral')

const {
  govukDate,
  govukDateTime,
  govukTime,
  isoDateFromDateInput,
  getDateParts,
  getDay,
  getMonth,
  getYear } = require('./helpers/date')

const {
  getAccreditationTypeLabel,
  getFeedbackRatingLabel,
  getProviderTypeLabel
} = require('./helpers/content')

/* ------------------------------------------------------------------
  numeral filter for use in Nunjucks
  example: {{ params.number | numeral("0,00.0") }}
  outputs: 1,000.00
------------------------------------------------------------------ */
addFilter('numeral', (number, format) => {
  return numeral(number).format(format)
})

/* ------------------------------------------------------------------
utility function to get an error for a component
example: {{ errors | getErrorMessage('title') }}
outputs: "Enter a title"
------------------------------------------------------------------ */
addFilter('getErrorMessage', (array, fieldName) => {
  if (!array || !fieldName) {
    return null
  }

  const error = array.filter((obj) =>
    obj.fieldName === fieldName
  )[0]

  return error
})

/* ------------------------------------------------------------------
utility function to get provider type label
example: {{ "scitt" | getProviderTypeLabel }}
outputs: "School-centred initial teacher training (SCITT)"
------------------------------------------------------------------ */
addFilter('getProviderTypeLabel', getProviderTypeLabel)

/* ------------------------------------------------------------------
utility function to get accreditation type label
example: {{ "notAccredited" | getAccreditationTypeLabel }}
outputs: "Not accredited"
------------------------------------------------------------------ */
addFilter('getAccreditationTypeLabel', getAccreditationTypeLabel)

/* ------------------------------------------------------------------
 date filter for use in Nunjucks
 example: {{ params.date | govukDate }}
 outputs: 1 January 1970
------------------------------------------------------------------ */
addFilter('govukDate', govukDate)

/* ------------------------------------------------------------------
 time filter for use in Nunjucks
 example: {{ params.date | govukTime }}
 outputs: 3:33pm
------------------------------------------------------------------ */
addFilter('govukTime', govukTime)

/* ------------------------------------------------------------------
 datetime filter for use in Nunjucks
 example: {{ params.date | govukDateTime }}
 outputs: 1 January 1970 at 3:33pm
 example: {{ params.date | govukDateTime("on") }}
 outputs: 3:33pm on 1 January 1970
------------------------------------------------------------------ */
addFilter('govukDateTime', govukDateTime)

/* ------------------------------------------------------------------
 date input filter for use in Nunjucks
 example: {{ params.dateObject | isoDateFromDateInput }}
 outputs: 1970-01-01
------------------------------------------------------------------ */
addFilter('isoDateFromDateInput', isoDateFromDateInput)

/* ------------------------------------------------------------------
get date part filter for use in Nunjucks
 example: {{ '1970-01-01' | getDateParts }}
 outputs: { day: 1, month: 1, year: 1970 }
------------------------------------------------------------------ */
addFilter('getDateParts', getDateParts)

/* ------------------------------------------------------------------
 get day filter for use in Nunjucks
 example: {{ '1970-01-01' | getDay }}
 outputs: 1
------------------------------------------------------------------ */
addFilter('getDay', getDay)

/* ------------------------------------------------------------------
 get month filter for use in Nunjucks
 example: {{ '1970-01-01' | getMonth }}
 outputs: 1
------------------------------------------------------------------ */
addFilter('getMonth', getMonth)

/* ------------------------------------------------------------------
 get year filter for use in Nunjucks
 example: {{ '1970-01-01' | getYear }}
 outputs: 1970
------------------------------------------------------------------ */
addFilter('getYear', getYear)

/* ------------------------------------------------------------------
utility function to get the feedback rating label
example: {{ 5 | getFeedbackRatingLabel }}
outputs: "Very satisfiled"
------------------------------------------------------------------ */
addFilter('getFeedbackRatingLabel', getFeedbackRatingLabel)

/* ------------------------------------------------------------------
utility function to parse markdown as HTML
example: {{ "## Title" | markdownToHtml }}
outputs: "<h2>Title</h2>"
------------------------------------------------------------------ */
addFilter('markdownToHtml', (markdown) => {
  if (!markdown) {
    return null
  }

  marked.use(gfmHeadingId())

  const text = markdown.replace(/\\r/g, '\n').replace(/\\t/g, ' ')
  const html = marked.parse(text)

  // Add govuk-* classes
  let govukHtml = html.replace(/<p>/g, '<p class="govuk-body">')
  govukHtml = govukHtml.replace(/<ol>/g, '<ol class="govuk-list govuk-list--number">')
  govukHtml = govukHtml.replace(/<ul>/g, '<ul class="govuk-list govuk-list--bullet">')
  govukHtml = govukHtml.replace(/<h2/g, '<h2 class="govuk-heading-l"')
  govukHtml = govukHtml.replace(/<h3/g, '<h3 class="govuk-heading-m"')
  govukHtml = govukHtml.replace(/<h4/g, '<h4 class="govuk-heading-s"')

  return govukHtml
})
