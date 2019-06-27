import { CapabilitiesReply, TrafficSourcesOverviewReply } from './types/similarweb-api';
import { buildUrl, cleanDomain, httpGet, retrieveOrGet, retrieveOrGetAll, dateToYearMonth, UrlDataMap } from './utils';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSchema(request): object {
  const fields = getConnectorFields().build();
  return { schema: fields };
}

enum EndpointType {
  WebDesktopData = 'web_desktop_data',
  WebMobileData = 'web_mobile_data',
  AppData = 'app_data',
  AppEngagmentData = 'app_engagement_data'
}

class ApiConfiguration {
  private static capData: CapabilitiesReply;
  private static apiKey: string;
  private static instance: ApiConfiguration;

  private constructor() {
  }

  public static getInstance(): ApiConfiguration {
    if (!ApiConfiguration.instance) {
      ApiConfiguration.instance = new ApiConfiguration();
    }

    return ApiConfiguration.instance;
  }

  public setApiKey(apiKey: string): void {
    ApiConfiguration.apiKey = apiKey;
    ApiConfiguration.capData = retrieveOrGet('https://api.similarweb.com/capabilities', { 'api_key': apiKey }) as CapabilitiesReply;
  }

  public hasApiKey(): boolean {
    return !!ApiConfiguration.apiKey;
  }

  /**
   * Returns the default parameters for the API request, including the start and
   * end dates, based on the API key access rights. Returns null country is not available.
   * @param endpointType Type of the endpoint you want to get the parameters for
   * @param country 2-letter ISO country code, or 'world' for Worldwide
   */
  public getDefaultParams(endpointType: EndpointType, country: string): object {
    const capData = ApiConfiguration.capData;
    const params = {
      'api_key': ApiConfiguration.apiKey,
      'country': country,
      'granularity': 'monthly',
      'main_domain_only': 'false',
      'show_verified': 'false'
    };
    if (!capData.hasOwnProperty(endpointType)) {
      console.log('capabilities - ', JSON.stringify(capData));
      DataStudioApp.createCommunityConnector()
        .newUserError()
        .setDebugText(`Invalid Endpoint Type : ${endpointType}`)
        .setText(`An error has occurred, please contact the developers to fix the problem.`)
        .throwException();
    }

    // Check if the country is available for the selected API key
    if (capData[endpointType].countries.some((c): boolean => c.code.toLowerCase() === country)) {
      params['start_date'] = dateToYearMonth(capData.web_desktop_data.snapshot_interval.start_date);
      params['end_date'] = dateToYearMonth(capData.web_desktop_data.snapshot_interval.end_date);
    }
    else {
      return null;
    }

    return params;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/camelcase
function buildRow(requestedFields: GoogleAppsScript.Data_Studio.Fields, date: string, dom: string, channel: string, value: number): any[] {
  const row = [];
  requestedFields.asArray().forEach((field): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (field.getId()) {
      case 'visits':
        row.push(value);
        break;
      case 'date':
        row.push(date.split('-').slice(0, 3).join(''));
        break;
      case 'year_month':
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
    data.visits[dom].forEach((src): void => {
      src.visits.forEach((monthlyValues): void => {
        const date = monthlyValues.date;
        switch (src.source_type) {
          case 'Search':
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Organic Search', monthlyValues.organic) });
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Paid Search', monthlyValues.paid) });
            break;
          case 'Social':
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Social', monthlyValues.organic) });
            break;
          case 'Mail':
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Email', monthlyValues.organic) });
            break;
          case 'Display Ads':
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Display Ads', monthlyValues.paid) });
            break;
          case 'Direct':
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Direct', monthlyValues.organic) });
            break;
          case 'Referrals':
            requestedData.push({ values: buildRow(requestedFields, date, dom, 'Referrals', monthlyValues.organic) });
            break;
        }
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
  const urls =  domains.map((domain): string => buildUrl(`https://api.similarweb.com/v1/website/${domain}/traffic-sources/overview-share`, params));
  const responses = retrieveOrGetAll(urls);

  const tabularData = buildTabularData(requestedFields, responses);

  return {
    schema: requestedFields.build(),
    rows: tabularData
  };
}
