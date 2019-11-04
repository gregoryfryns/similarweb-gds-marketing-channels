import { CapabilitiesReply, TrafficSourcesOverviewReply } from './types/similarweb-api';
import { buildUrl, cleanDomain, httpGet, retrieveOrGetAll, UrlDataMap, ApiConfiguration, EndpointType } from './utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getAuthType(): object {
  const cc = DataStudioApp.createCommunityConnector();

  return cc.newAuthTypeResponse()
    .setAuthType(cc.AuthType.KEY)
    .setHelpUrl('https://account.similarweb.com/#/api-management')
    .build();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function resetAuth(): void {
  const userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty('dscc.similarwebapi.key');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isAuthValid(): boolean {
  const userProperties = PropertiesService.getUserProperties();
  const key = userProperties.getProperty('dscc.similarwebapi.key');

  let data = null;

  if (key) {
    const response = UrlFetchApp.fetch('https://api.similarweb.com/capabilities?api_key=' + key, { muteHttpExceptions: true });
    data = JSON.parse(response.getContentText()) as CapabilitiesReply;
  }

  return (data && data.hasOwnProperty('remaining_hits'));
}

// TODO: look for a proper way to implement this function
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isAdminUser(): boolean {
  const adminUsersWhitelist = [
    'gregory.fryns@similarweb.com',
    'gregory.fryns@gmail.com'
  ];
  const email = Session.getEffectiveUser().getEmail();

  return adminUsersWhitelist.indexOf(email) > -1;
}

/**
 * Checks if the submitted key is valid
 * @param key The Similarweb API key to be checked
 * @return True if the key is valid, false otherwise
 */
function checkForValidKey(key: string): boolean {
  // Check key format
  if (!key.match(/[0-9a-f]{32}/i)) {
    return false;
  }

  // Check if key is valid
  const data = httpGet(buildUrl('https://api.similarweb.com/capabilities', { 'api_key': key }));

  return (data && data.hasOwnProperty('remaining_hits'));
}

/**
 * Sets the credentials.
 * @param request The set credentials request.
 * @return An object with an errorCode.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setCredentials(request): object {
  const key = request.key.trim().toLowerCase();

  const isValid = checkForValidKey(key);
  if (!isValid) {
    return {
      errorCode: 'INVALID_CREDENTIALS'
    };
  }
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('dscc.similarwebapi.key', key);

  return {
    errorCode: 'NONE'
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/camelcase
function getConfig(): GoogleAppsScript.Data_Studio.Config {
  const cc = DataStudioApp.createCommunityConnector();
  const config = cc.getConfig();

  config.newInfo()
    .setId('instructions')
    .setText('You can find your SimilarWeb API key or create a new one here (a SimilarWeb Pro account is needed): https://account.similarweb.com/#/api-management');

  config.newTextInput()
    .setId('domains')
    .setName('Domains')
    .setHelpText('Enter the name of up to 25 domains you would like to analyze, separated by commas (e.g. cnn.com, foxnews.com, washingtonpost.com, nytimes.com)')
    .setPlaceholder('e.g.: cnn.com, foxnews.com, washingtonpost.com, nytimes.com')
    .setAllowOverride(true);

  config.newTextInput()
    .setId('country')
    .setName('Country Code')
    .setHelpText('ISO 2-letter country code of the country (e.g. us, gb - world for Worldwide)')
    .setPlaceholder('e.g.: us')
    .setAllowOverride(true);

  return config.build();
}

// eslint-disable-next-line @typescript-eslint/camelcase
function getConnectorFields(): GoogleAppsScript.Data_Studio.Fields {
  const cc = DataStudioApp.createCommunityConnector();
  const fields = cc.getFields();
  const types = cc.FieldType;
  const aggregations = cc.AggregationType;

  fields.newDimension()
    .setId('date')
    .setName('Date')
    .setType(types.YEAR_MONTH_DAY);

  fields.newDimension()
    .setId('year_month')
    .setName('Date (Year & Month)')
    .setType(types.YEAR_MONTH);

  fields.newDimension()
    .setId('device')
    .setName('Device Type')
    .setType(types.TEXT);

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

  fields.newDimension()
    .setId('organic_paid')
    .setName('Organic/Paid')
    .setGroup('Dimensions')
    .setDescription('Organic/Paid')
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSchema(request): object {
  const fields = getConnectorFields().build();
  return { schema: fields };
}

interface RowData {
  date: string;
  domain: string;
  device: string;
  channel: string;
  organicPaid: string;
  visits: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/camelcase
function buildRow(requestedFields: GoogleAppsScript.Data_Studio.Fields, values: RowData): any[] {
  const row = [];
  const { date, domain, device, channel, organicPaid, visits } = values;
  requestedFields.asArray().forEach((field): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (field.getId()) {
      case 'visits':
        row.push(visits);
        break;
      case 'date':
        row.push(date.split('-').slice(0, 3).join(''));
        break;
      case 'year_month':
        row.push(date.split('-').slice(0, 2).join(''));
        break;
      case 'domain':
        row.push(domain);
        break;
      case 'device':
        row.push(device);
        break;
      case 'channel':
        row.push(channel);
        break;
      case 'organic_paid':
        row.push(organicPaid);
        break;
      default:
        row.push('');
    }
  });

  return row;
}

enum DeviceType {
  Desktop = 'Desktop',
  MobileWeb = 'Mobile Web'
}

// eslint-disable-next-line @typescript-eslint/camelcase, @typescript-eslint/no-explicit-any
function buildTabularData(requestedFields: GoogleAppsScript.Data_Studio.Fields, responses: UrlDataMap): any[][] {
  const requestedData = [];
  Object.keys(responses).forEach((url): void => {
    const data = responses[url] as TrafficSourcesOverviewReply;
    if (!(data && data.meta && data.meta.status && data.meta.status === 'Success')) {
      DataStudioApp.createCommunityConnector()
        .newUserError()
        .setDebugText(`Could find domain data for URL : ${url}`)
        .setText('An error occurred while processing the data. Please report this issue to the developer.')
        .throwException();
    }

    const dom = data.meta.request.domain;

    let deviceType: DeviceType;
    if (data && data.visits && data.visits[dom] && data.visits[dom][0].visits[0].hasOwnProperty('organic')) {
      deviceType = DeviceType.Desktop;
    }
    else if (data && data.visits && data.visits[dom] && data.visits[dom][0].visits[0].hasOwnProperty('visits')) {
      deviceType = DeviceType.MobileWeb;
    }

    data.visits[dom].forEach((src): void => {
      const rowData: RowData = {
        domain: dom,
        device: deviceType,
        date: '',
        channel: '',
        organicPaid: '',
        visits: 0
      };

      src.visits.forEach((monthlyValues): void => {
        const date = monthlyValues.date;
        rowData.date = date;
        switch (src.source_type) {
          case 'Search':
            rowData.channel = 'Search';
            if (deviceType === DeviceType.Desktop) {
              rowData.organicPaid = 'Organic';
              rowData.visits = monthlyValues.organic;

              rowData.organicPaid = 'Paid';
              rowData.visits = monthlyValues.paid;
            }
            else if (deviceType === DeviceType.MobileWeb) {
              rowData.organicPaid = 'Organic & Paid';
              rowData.visits = monthlyValues.visits;
            }
            break;
          case 'Mail':
            rowData.channel = 'Email';
            rowData.organicPaid = 'Organic';
            rowData.visits = deviceType === DeviceType.Desktop ? monthlyValues.organic : monthlyValues.visits;
            break;
          case 'Display Ads':
            rowData.channel = 'Display Ads';
            rowData.organicPaid = 'Paid';
            rowData.visits = deviceType === DeviceType.Desktop ? monthlyValues.paid : monthlyValues.visits;
            break;
          default:
            rowData.channel = src.source_type;
            rowData.organicPaid = 'Organic';
            rowData.visits = deviceType === DeviceType.Desktop ? monthlyValues.organic : monthlyValues.visits;
            break;
        }
        requestedData.push({ values: buildRow(requestedFields, rowData) });
      });
    });
  });

  return requestedData;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getData(request): object {
  const MAX_NB_DOMAINS = 25;

  const country = request.configParams.country.trim().toLowerCase() as string;
  const domains = request.configParams.domains.split(',').slice(0, MAX_NB_DOMAINS).map(cleanDomain) as string[];

  const requestedFieldIDs = request.fields.map((field): string => field.name);
  console.log('requested fields ids', JSON.stringify(requestedFieldIDs));
  const requestedFields = getConnectorFields().forIds(requestedFieldIDs);

  const apiKey = PropertiesService.getUserProperties().getProperty('dscc.similarwebapi.key');
  const configurator = ApiConfiguration.getInstance();
  configurator.setApiKey(apiKey);

  const params = configurator.getDefaultParams(EndpointType.WebDesktopData, country);
  const urlsDesktop = domains.map((domain): string => buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/overview-share`, params));
  const urlsMobile = domains.map((domain): string => buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/mobile-overview-share`, params));

  const urls = [].concat(urlsDesktop, urlsMobile);
  const responses = retrieveOrGetAll(urls);

  const tabularData = buildTabularData(requestedFields, responses);

  return {
    schema: requestedFields.build(),
    rows: tabularData
  };
}
