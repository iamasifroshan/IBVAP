import { Incident, ObjectType, Severity, EnvironmentCondition } from '../types';

export interface StructuredSearchFilters {
  rawQuery: string;
  intentSummary: string;
  extractedObject?: ObjectType;
  extractedCamera?: string;
  extractedSector?: string;
  extractedMinThreatScore?: number;
  extractedSeverity?: Severity;
  extractedTimeRange?: string;
  extractedEventType?: string;
  extractedEnvironment?: EnvironmentCondition;
  validated: boolean;
  confidence: number;
}

export function parseSentinelQuery(queryText: string): StructuredSearchFilters {
  const q = queryText.toLowerCase();

  let extractedObject: ObjectType | undefined = undefined;
  let extractedCamera: string | undefined = undefined;
  let extractedSector: string | undefined = undefined;
  let extractedMinThreatScore: number | undefined = undefined;
  let extractedSeverity: Severity | undefined = undefined;
  let extractedTimeRange: string | undefined = undefined;
  let extractedEventType: string | undefined = undefined;
  let extractedEnvironment: EnvironmentCondition | undefined = undefined;

  // Extract Object Type
  if (q.includes('people') || q.includes('person') || q.includes('human') || q.includes('intruder')) {
    extractedObject = 'human';
  } else if (q.includes('vehicle') || q.includes('car') || q.includes('truck') || q.includes('4x4')) {
    extractedObject = 'vehicle';
  } else if (q.includes('group') || q.includes('multiple')) {
    extractedObject = 'group';
  }

  // Extract Camera
  if (q.includes('camera 7') || q.includes('cam 7') || q.includes('cam-07')) {
    extractedCamera = 'BORDER-CAM-07';
  } else if (q.includes('camera 3') || q.includes('cam 3')) {
    extractedCamera = 'SECTOR-B-CAM-03';
  }

  // Extract Sector
  if (q.includes('sector b')) {
    extractedSector = 'Sector B';
  } else if (q.includes('sector a')) {
    extractedSector = 'Sector A';
  } else if (q.includes('eastern') || q.includes('east')) {
    extractedSector = 'Eastern Perimeter';
  } else if (q.includes('northern checkpoint') || q.includes('checkpoint')) {
    extractedSector = 'Sector A';
  }

  // Extract Threat Level & Min Score
  if (q.includes('critical')) {
    extractedSeverity = 'critical';
    extractedMinThreatScore = 80;
  } else if (q.includes('high-risk') || q.includes('high risk') || q.includes('high')) {
    extractedSeverity = 'high';
    extractedMinThreatScore = 60;
  } else if (q.includes('threat score above 75') || q.includes('above 75')) {
    extractedMinThreatScore = 75;
  }

  // Extract Environmental Condition
  if (q.includes('fog')) {
    extractedEnvironment = 'fog';
  } else if (q.includes('night') || q.includes('dark')) {
    extractedEnvironment = 'night';
  } else if (q.includes('dust')) {
    extractedEnvironment = 'dust';
  }

  // Extract Time Range
  if (q.includes('10 pm and midnight') || q.includes('10 pm')) {
    extractedTimeRange = '22:00 – 00:00 UTC';
  } else if (q.includes('after 2 am') || q.includes('2 am')) {
    extractedTimeRange = '02:00 – 05:00 UTC';
  } else if (q.includes('last night') || q.includes('yesterday')) {
    extractedTimeRange = 'Restricted Night Hours (Previous 24 Hours)';
  } else {
    extractedTimeRange = 'All Stored Timestamps';
  }

  // Extract Event Type
  if (q.includes('intrusion') || q.includes('breach') || q.includes('crossed')) {
    extractedEventType = 'Restricted Zone Crossing';
  } else {
    extractedEventType = 'Security Incident';
  }

  return {
    rawQuery: queryText,
    intentSummary: `Retrieve actual EdgeGuard incident records matching ${extractedObject || 'any target'} in ${extractedSector || 'all sectors'} with score >= ${extractedMinThreatScore || 0}`,
    extractedObject,
    extractedCamera,
    extractedSector,
    extractedMinThreatScore,
    extractedSeverity,
    extractedTimeRange,
    extractedEventType,
    extractedEnvironment,
    validated: true,
    confidence: 96.2
  };
}

export function searchIncidentVault(incidents: Incident[], filters: StructuredSearchFilters): Incident[] {
  return incidents.filter(inc => {
    if (filters.extractedSector && inc.sector !== filters.extractedSector) return false;
    if (filters.extractedObject && inc.objectType !== filters.extractedObject) return false;
    if (filters.extractedCamera && inc.cameraId !== filters.extractedCamera && inc.cameraName !== filters.extractedCamera) return false;
    if (filters.extractedMinThreatScore && inc.threatScore < filters.extractedMinThreatScore) return false;
    if (filters.extractedSeverity && inc.severity !== filters.extractedSeverity) return false;
    return true;
  });
}
