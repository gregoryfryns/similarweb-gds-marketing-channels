/* global DataStudioApp, Session */

if (typeof(require) !== 'undefined') {
  var retrieveOrGet = require('./utils.js')['retrieveOrGet'];
}

// eslint-disable-next-line no-unused-vars
function getAuthType(request) {
  var response = { type: 'NONE' };
  return response;
}

// eslint-disable-next-line no-unused-vars
function getConfig() {
  var cc = DataStudioApp.createCommunityConnector();
  var config = cc.getConfig();

  config.newInfo()
    .setId('instructions')
    .setText('You can find your SimilarWeb API key or create a new one here (a SimilarWeb Pro account is needed): https://account.similarweb.com/#/api-management');

  config.newTextInput()
    .setId('apiKey')
    .setName('Your SimilarWeb API key')
    .setHelpText('Enter your 32-character SimilarWeb API key')
    .setPlaceholder('1234567890abcdef1234567890abcdef');

  config.newTextInput()
    .setId('domains')
    .setName('Domains')
    .setHelpText('Enter the name of up to 10 domains you would like to analyze, separated by commas (e.g. cnn.com, bbc.com, nytimes.com)')
    .setPlaceholder('cnn.com, bbc.com, nytimes.com')
    .setAllowOverride(true);

  config.newTextInput()
    .setId('country')
    .setName('Country Code')
    .setHelpText('ISO 2-letter country code of the country (e.g. us, gb - world for Worldwide)')
    .setPlaceholder('us')
    .setAllowOverride(true);

  return config.build();
}

// eslint-disable-next-line no-unused-vars
function getConnectorFields() {
  var cc = DataStudioApp.createCommunityConnector();
  var fields = cc.getFields();
  var types = cc.FieldType;
  var aggregations = cc.AggregationType;

  fields.newDimension()
    .setId('date')
    .setName('Date')
    .setType(types.YEAR_MONTH);

  fields.newDimension()
    .setId('domain')
    .setName('Domain')
    .setGroup('Dimensions')
    .setType(types.TEXT);

  fields.newDimension()
    .setId('channel')
    .setName('Channel')
    .setGroup('Dimensions')
    .setDescription('Traffic Source Channel')
    .setType(types.TEXT);

  fields.newMetric()
    .setId('visits')
    .setName('Visits')
    .setDescription('SimilarWeb estimated number of visits')
    .setType(types.NUMBER)
    .setIsReaggregatable(true)
    .setAggregation(aggregations.SUM);

  fields.setDefaultDimension('domain');
  fields.setDefaultMetric('visits');

  return fields;
}

// eslint-disable-next-line no-unused-vars
function getSchema(request) {
  var fields = getConnectorFields().build();
  return { schema: fields };
}

// eslint-disable-next-line no-unused-vars
function getData(request) {
  var MAX_NB_DOMAINS = 10;
  var country = request.configParams.country.trim().toLowerCase();
  var apiKey = request.configParams.apiKey.trim().toLowerCase();
  var domains = request.configParams.domains.split(',').slice(0, MAX_NB_DOMAINS).map(function(domain) {
    return domain.trim().replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').replace(/\/.*$/i, '').toLowerCase();
  });

  var requestedFieldIDs = request.fields.map(function(field) {
    return field.name;
  });
  console.log('requested fields ids', JSON.stringify(requestedFieldIDs));
  var requestedFields = getConnectorFields().forIds(requestedFieldIDs);

  var url = 'https://api.similarweb.com/v1/website/xxx/traffic-sources/overview-share';
  // Prepare data to be fetched

  var collectedData = {};
  var params = generateApiParams(apiKey, country);

  domains.forEach(function(domain) {
    collectedData[domain] = {};

    // data[domain] = collectData(endpoints, domain, country, apiKey);
    params.desktop['domain'] = domain;
    var data = retrieveOrGet(url, params.desktop);
    if (data && data.visits && data.visits[domain]) {
      data.visits[domain].forEach(function(src) {
        src.visits.forEach(function(monthlyValues) {
          var date = monthlyValues.date;
          if (!collectedData[domain].hasOwnProperty(date)) {
            collectedData[domain][date] = {};
          }
          collectedData[domain][date][src.source_type] = { organic: monthlyValues.organic, paid: monthlyValues.paid };
        });
      });
    }
  });

  return {
    schema: requestedFields.build(),
    rows: buildTabularData(requestedFields, collectedData)
  };
}

// eslint-disable-next-line no-unused-vars
function isAdminUser() {
  var adminUsersWhitelist = [
    'gregory.fryns@similarweb.com',
    'gregory.fryns@gmail.com'
  ];
  var email = Session.getEffectiveUser().getEmail();
  return adminUsersWhitelist.indexOf(email) > -1;
}

// eslint-disable-next-line no-unused-vars
function throwError (message, userSafe) {
  if (userSafe) {
    message = 'DS_USER:' + message;
  }
  throw new Error(message);
}

function buildTabularData(requestedFields, data) {
  var requestedData = [];

  Object.keys(data).forEach(function(dom) {
    var desktopData = data[dom];
    Object.keys(desktopData).forEach(function(date) {
      Object.keys(desktopData[date]).forEach(function(src) {
        var srcTraffic = desktopData[date][src];
        switch (src) {
        case 'Search':
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Organic Search', srcTraffic.organic) });
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Paid Search', srcTraffic.paid) });
          break;
        case 'Social':
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Social', srcTraffic.organic) });
          break;
        case 'Mail':
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Email', srcTraffic.organic) });
          break;
        case 'Display Ads':
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Display Ads', srcTraffic.paid) });
          break;
        case 'Direct':
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Direct', srcTraffic.organic) });
          break;
        case 'Referrals':
          requestedData.push({ values: buildRow(requestedFields, date, dom, 'Referrals', srcTraffic.organic) });
          break;
        }
      });
    });
  });

  return requestedData;
}

function buildRow(requestedFields, date, dom, channel, value) {
  var row = [];
  requestedFields.asArray().forEach(function (field) {
    switch (field.getId()) {
    case 'visits':
      row.push(value);
      break;
    case 'date':
      row.push(date.split('-').slice(0, 2).join(''));
      break;
    case 'domain':
      row.push(dom);
      break;
    case 'channel':
      row.push(channel);
      break;
    default:
      row.push('');
    }
  });

  return row;
}

/**
 * Generate an object with 2 objects containing the API parameters to be used for the SW desktop
 * and mobile web API requests respectively
 *
 * @param {string} apiKey - SimilarWeb API Key
 * @param {string} country - 2-letter ISO country code of the desired country or 'world' for Worldwide
 * @param {?string} domain - desired domain
 * @return {object} - Object containing two objects: desktop & mobile with the API parameters to specific
 *   to desktop and mobile web requests respectively
 */
function generateApiParams(apiKey, country, domain) {
  var capData = retrieveOrGet('https://api.similarweb.com/capabilities', { api_key: apiKey });
  var params = { desktop: null, mobile: null };

  if (capData && capData.remaining_hits && capData.web_desktop_data && capData.web_mobile_data) {
    var paramsCommon = {
      api_key: apiKey,
      country: country,
      domain: domain,
      granularity: 'monthly',
      main_domain_only: 'false',
      show_verified: 'false'
    };
    if (domain !== undefined) {
      paramsCommon['domain'] = domain;
    }

    // If the selected country is available for that API key (desktop)
    if (capData.web_desktop_data.countries.some(function(c) {return c.code.toLowerCase() == country;})) {
      params.desktop = JSON.parse(JSON.stringify(paramsCommon)); // clone paramsCommon object
      params.desktop['start_date'] = capData.web_desktop_data.snapshot_interval.start_date.split('-').slice(0, 2).join('-');
      params.desktop['end_date'] = capData.web_desktop_data.snapshot_interval.end_date.split('-').slice(0, 2).join('-');
    }

    // If the selected country is available for that API key (mobile web)
    if (capData.web_mobile_data.countries.some(function(c) {return c.code.toLowerCase() == country;})) {
      params.mobile = JSON.parse(JSON.stringify(paramsCommon)); // clone paramsCommon object
      params.mobile['start_date'] = capData.web_mobile_data.snapshot_interval.start_date.split('-').slice(0, 2).join('-');
      params.mobile['end_date'] = capData.web_mobile_data.snapshot_interval.end_date.split('-').slice(0, 2).join('-');
    }
  }

  return params;
}
