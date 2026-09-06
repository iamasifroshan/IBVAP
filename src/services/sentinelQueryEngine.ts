import { Incident, ObjectType, Severity, EnvironmentCondition } from '../types';

export interface StructuredSearchFilters {
  rawQuery: string;
  intentSummary: string;
  extractedObject?: ObjectType | 'any' | string;
  extractedCamera?: string;
  extractedSector?: string;
  extractedOutpost?: string;
  extractedMinThreatScore?: number;
  extractedSeverity?: Severity;
  extractedThreat?: string;
  extractedTimeRange?: string;
  extractedEventType?: string;
  extractedEnvironment?: EnvironmentCondition | string;
  extractedPlate?: string;
  extractedTrack?: string;
  validated: boolean;
  confidence: number;
  recognizedSlots?: string[];
  missingSlots?: string[];
  // Internal filter slots for client-side search execution
  _startHour?: number;
  _endHour?: number;
  _dateFilter?: string;
  _suspiciousType?: string;
  _trackFilter?: string;
}

export function parseSentinelQuery(queryText: string): StructuredSearchFilters {
  const q = (queryText || '').toLowerCase().trim();

  if (!q) {
    return {
      rawQuery: queryText || '',
      intentSummary: 'Please enter an incident search query.',
      extractedObject: 'Any Target',
      extractedCamera: 'All Cameras',
      extractedSector: 'All Sectors',
      extractedTimeRange: 'All Stored Timestamps',
      extractedThreat: 'All Scores',
      extractedEnvironment: 'Any',
      extractedEventType: 'Security Incident',
      validated: false,
      confidence: 0.0,
      recognizedSlots: [],
      missingSlots: ['Object / Target Class', 'Sector / Location', 'Time Range']
    };
  }

  // 1. Object Type Extraction
  let extractedObject: string | undefined = undefined;
  if (/\b(people|person|human|humans|pedestrian|pedestrians|intruder|intruders|man|men|woman|women)\b/i.test(q)) {
    extractedObject = 'human';
  } else if (/\b(vehicle|vehicles|car|cars|truck|trucks|jeep|jeeps|4x4|suv|suvs|bike|bikes|motor)\b/i.test(q)) {
    extractedObject = 'vehicle';
  } else if (/\b(drone|drones|uav|quadcopter)\b/i.test(q)) {
    extractedObject = 'drone';
  } else if (/\b(animal|animals|cattle|livestock|wildlife)\b/i.test(q)) {
    extractedObject = 'animal';
  } else if (/\b(group|multiple|crowd)\b/i.test(q)) {
    extractedObject = 'group';
  } else if (/\bany\b/i.test(q)) {
    extractedObject = 'any';
  }

  // 2. Camera Extraction
  let extractedCamera: string | undefined = undefined;
  const camMatch = q.match(/\b(?:camera|cam)\s*(\d+|[a-z0-9\-]+)\b/i);
  if (camMatch) {
    const camVal = camMatch[1].toUpperCase();
    if (camVal === '7' || camVal === '07') {
      extractedCamera = 'BORDER-CAM-07';
    } else if (camVal === '3' || camVal === '03') {
      extractedCamera = 'SECTOR-B-CAM-03';
    } else if (camVal === '2' || camVal === '02') {
      extractedCamera = 'BOP-NORTH-02';
    } else if (camVal === '4' || camVal === '04') {
      extractedCamera = 'EAST-PERIM-04';
    } else if (camVal === '10') {
      extractedCamera = 'SOUTH-TRENCH-10';
    } else {
      extractedCamera = `CAM-${camVal}`;
    }
  } else if (q.includes('checkpoint cam')) {
    extractedCamera = 'BOP-NORTH-02';
  } else if (q.includes('border cam') || q.includes('border camera')) {
    extractedCamera = 'BORDER-CAM-07';
  }

  // 3. Sector & Outpost Extraction (Check landmarks first)
  let extractedSector: string | undefined = undefined;
  let extractedOutpost: string | undefined = undefined;

  if (/\b(northern checkpoint|checkpoint)\b/i.test(q)) {
    extractedSector = 'Sector A';
    extractedOutpost = 'Northern Checkpoint';
  } else if (/\b(eastern|east sector|east perimeter)\b/i.test(q)) {
    extractedSector = 'Eastern Perimeter';
  } else if (/\b(southern|south sector|south perimeter)\b/i.test(q)) {
    extractedSector = 'South Perimeter';
  } else {
    const secMatch = q.match(/\bsector\s+([a-z0-9]+)\b/i);
    if (secMatch) {
      extractedSector = `Sector ${secMatch[1].toUpperCase()}`;
    }
  }

  // 4. Threat Level & Min Score
  let extractedSeverity: Severity | undefined = undefined;
  let extractedMinThreatScore: number | undefined = undefined;

  if (q.includes('critical')) {
    extractedSeverity = 'critical';
    extractedMinThreatScore = 80;
  } else if (q.includes('high-risk') || q.includes('high risk') || q.includes('high')) {
    extractedSeverity = 'high';
    extractedMinThreatScore = 60;
  } else if (q.includes('medium')) {
    extractedSeverity = 'medium';
    extractedMinThreatScore = 40;
  } else if (q.includes('low')) {
    extractedSeverity = 'low';
    extractedMinThreatScore = 20;
  }

  const scoreMatch = q.match(/\b(?:above|greater than|>|score above)\s*(\d+)\b/i);
  if (scoreMatch) {
    extractedMinThreatScore = parseInt(scoreMatch[1], 10);
  }

  // 5. Environmental Condition
  let extractedEnvironment: EnvironmentCondition | undefined = undefined;
  if (/\b(fog|foggy|mist|haze)\b/i.test(q)) {
    extractedEnvironment = 'fog';
  } else if (/\b(at night|during night|night condition|in the dark)\b/i.test(q)) {
    extractedEnvironment = 'night';
  } else if (/\b(rain|rainy|raining|downpour)\b/i.test(q)) {
    extractedEnvironment = 'fog'; // 'rain' maps to fog (nearest EnvironmentCondition)
  } else if (/\bdust\b/i.test(q)) {
    extractedEnvironment = 'dust';
  }

  // 6. Time Range & Date Extraction
  let extractedTimeRange: string = 'All Stored Timestamps';
  let _startHour: number | undefined = undefined;
  let _endHour: number | undefined = undefined;
  let _dateFilter: string | undefined = undefined;

  if (q.includes('yesterday')) {
    _dateFilter = 'yesterday';
  } else if (q.includes('today')) {
    _dateFilter = 'today';
  } else if (q.includes('last night')) {
    _dateFilter = 'last_night';
    extractedTimeRange = 'Restricted Night Hours (20:00 – 06:00 IST)';
  }

  if (q.includes('10 pm and midnight') || (q.includes('10 pm') && q.includes('midnight'))) {
    extractedTimeRange = '22:00 – 00:00 IST';
    _startHour = 22;
    _endHour = 24;
  } else if (q.includes('after 2 am') || q.includes('2 am')) {
    extractedTimeRange = '02:00 – 06:00 IST (Post-Curfew)';
    _startHour = 2;
    _endHour = 6;
  } else if (q.includes('after 10 pm')) {
    extractedTimeRange = '22:00 – 23:59 IST';
    _startHour = 22;
    _endHour = 24;
  }

  // 7. Event Type & Suspicious Behavior
  let extractedEventType = 'Security Incident';
  let _suspiciousType: string | undefined = undefined;
  if (q.includes('unusual stop')) {
    _suspiciousType = 'SUSPICIOUS_UNUSUAL_STOP';
    extractedEventType = 'Unusual Stop';
  } else if (q.includes('loitering')) {
    _suspiciousType = 'SUSPICIOUS_LOITERING';
    extractedEventType = 'Loitering';
  } else if (q.includes('rapid movement')) {
    _suspiciousType = 'SUSPICIOUS_RAPID_MOVEMENT';
    extractedEventType = 'Rapid Movement';
  } else if (q.includes('restricted zone behavior') || q.includes('zone behavior')) {
    _suspiciousType = 'SUSPICIOUS_RESTRICTED_ZONE_BEHAVIOR';
    extractedEventType = 'Restricted Zone Behavior';
  } else if (q.includes('suspicious activity') || q.includes('suspicious')) {
    _suspiciousType = 'SUSPICIOUS';
    extractedEventType = 'Suspicious Activity';
  } else if (q.includes('night movement') || q.includes('night-time movement') || q.includes('night walking') || q.includes('movement at night')) {
    _suspiciousType = 'NIGHT_MOVEMENT_DETECTED';
    extractedEventType = 'Night Movement';
  } else if (/\b(intrusion|breach|trespass|crossed|crossing)\b/i.test(q)) {
    extractedEventType = 'Restricted Zone Breach';

  } else if (q.includes('vehicle')) {
    extractedEventType = 'Vehicle Movement';
  } else if (q.includes('people') || q.includes('human')) {
    extractedEventType = 'Human Detection';
  }

  // 8. Track extraction
  let _trackFilter: string | undefined = undefined;
  const trkMatch = q.match(/\b(?:trk#?|track\s*#?)\s*(\d+)\b/i);
  if (trkMatch) {
    _trackFilter = `TRK#${trkMatch[1]}`;
  }

  // Calculate recognized slots
  const recognizedSlots: string[] = [];
  if (extractedObject) recognizedSlots.push(`Object: ${extractedObject.charAt(0).toUpperCase() + extractedObject.slice(1)}`);
  if (extractedCamera) recognizedSlots.push(`Camera: ${extractedCamera}`);
  if (extractedSector) recognizedSlots.push(`Sector: ${extractedSector}`);
  if (extractedSeverity) recognizedSlots.push(`Threat: ${extractedSeverity.toUpperCase()}`);
  if (extractedEnvironment) recognizedSlots.push(`Environment: ${extractedEnvironment.toUpperCase()}`);
  if (_dateFilter) recognizedSlots.push(`Date: ${_dateFilter === 'yesterday' ? 'Yesterday' : _dateFilter === 'last_night' ? 'Last Night' : 'Today'}`);
  if (_startHour !== undefined || q.includes('last night')) recognizedSlots.push(`Time: ${extractedTimeRange}`);
  if (_trackFilter) recognizedSlots.push(`Track: ${_trackFilter}`);
  if (_suspiciousType) recognizedSlots.push(`Behavior: ${extractedEventType}`);

  const validated = recognizedSlots.length > 0;
  const confidence = validated ? Math.min(95.4, Number((65.0 + recognizedSlots.length * 5.8).toFixed(1))) : 0.0;

  const missingSlots: string[] = [];
  if (!extractedObject && !_trackFilter) missingSlots.push('Object / Target Class');
  if (!extractedSector && !extractedCamera) missingSlots.push('Sector or Camera Location');
  if (_startHour === undefined && !_dateFilter) missingSlots.push('Time Range / Date');

  const intentParts: string[] = [];
  if (_trackFilter) intentParts.push(_trackFilter);
  if (extractedObject) intentParts.push(`${extractedObject} targets`);
  else if (!_trackFilter) intentParts.push('all target types');
  if (_suspiciousType) intentParts.push(`exhibiting ${extractedEventType.toLowerCase()}`);
  if (extractedSector) intentParts.push(`in ${extractedSector}`);
  if (extractedOutpost) intentParts.push(`near ${extractedOutpost}`);
  if (extractedCamera) intentParts.push(`on ${extractedCamera}`);
  if (extractedTimeRange !== 'All Stored Timestamps') intentParts.push(`(${extractedTimeRange})`);
  if (extractedSeverity) intentParts.push(`with ${extractedSeverity.toUpperCase()} threat`);
  if (extractedEnvironment) intentParts.push(`during ${extractedEnvironment}`);

  const intentSummary = validated
    ? `Retrieve real records for ${intentParts.join(' ')} from database.`
    : 'Query could not be parsed into recognized border security operational parameters.';

  return {
    rawQuery: queryText,
    intentSummary,
    extractedObject: (extractedObject ? extractedObject.charAt(0).toUpperCase() + extractedObject.slice(1) : (_trackFilter ? 'Human' : 'Any Target')) as any,
    extractedCamera: extractedCamera || 'All Cameras',
    extractedSector: extractedSector || 'All Sectors',
    extractedOutpost,
    extractedMinThreatScore,
    extractedSeverity,
    extractedThreat: extractedSeverity ? extractedSeverity.toUpperCase() : 'All Scores',
    extractedTimeRange,
    extractedEventType,
    extractedEnvironment: extractedEnvironment ? extractedEnvironment.toUpperCase() : 'Any',
    extractedTrack: _trackFilter,
    validated,
    confidence,
    recognizedSlots,
    missingSlots,
    _startHour,
    _endHour,
    _dateFilter,
    _suspiciousType,
    _trackFilter,
  };
}

export function searchIncidentVault(incidents: Incident[], filters: StructuredSearchFilters): Incident[] {
  if (!filters.validated) return [];

  return incidents.filter(inc => {
    // 1. Sector matching
    if (filters.extractedSector && filters.extractedSector !== 'All Sectors') {
      const incSector = (inc.sector || '').toLowerCase();
      const filterSector = filters.extractedSector.toLowerCase();
      if (!incSector.includes(filterSector) && !filterSector.includes(incSector)) {
        return false;
      }
    }

    // 2. Outpost matching
    if (filters.extractedOutpost) {
      const incOutpost = (inc.outpost || '').toLowerCase();
      const incZone = (inc.zoneName || '').toLowerCase();
      const filterOutpost = filters.extractedOutpost.toLowerCase();
      if (!incOutpost.includes(filterOutpost) && !incZone.includes(filterOutpost)) {
        return false;
      }
    }

    // 3. Object Type matching
    if (filters.extractedObject && filters.extractedObject !== 'Any Target' && filters.extractedObject !== 'any') {
      const filterObj = String(filters.extractedObject).toLowerCase();
      const incObj = (inc.objectType || '').toLowerCase();
      if (incObj !== filterObj) {
        return false;
      }
    }

    // 4. Camera matching
    if (filters.extractedCamera && filters.extractedCamera !== 'All Cameras') {
      const cam = filters.extractedCamera.toUpperCase();
      const incCamId = (inc.cameraId || '').toUpperCase();
      const incCamName = (inc.cameraName || '').toUpperCase();
      if (incCamId !== cam && incCamName !== cam) {
        return false;
      }
    }

    // 5. Threat score / Severity matching
    if (filters.extractedSeverity) {
      const targetSev = filters.extractedSeverity.toLowerCase();
      const incSev = (inc.severity || '').toLowerCase();
      if (targetSev === 'critical' && incSev !== 'critical') return false;
      if (targetSev === 'high' && incSev !== 'high' && incSev !== 'critical') return false;
    }
    if (filters.extractedMinThreatScore !== undefined && inc.threatScore < filters.extractedMinThreatScore) {
      return false;
    }

    // 6. Environment matching
    if (filters.extractedEnvironment && filters.extractedEnvironment !== 'Any') {
      const targetEnv = String(filters.extractedEnvironment).toLowerCase();
      const incEnv = (inc.environmentalCondition || '').toLowerCase();
      if (incEnv !== targetEnv) {
        return false;
      }
    }

    // 7. Date & Time matching
    if (inc.timestamp) {
      const incDate = new Date(inc.timestamp);
      if (!isNaN(incDate.getTime())) {
        const hour = incDate.getHours();

        if (filters._startHour !== undefined && filters._endHour !== undefined) {
          if (hour < filters._startHour || hour >= filters._endHour) {
            return false;
          }
        }

        if (filters._dateFilter === 'yesterday') {
          // Check date string: yesterday is 2026-09-04 relative to 2026-09-05
          const dateStr = typeof inc.timestamp === 'string' ? inc.timestamp : incDate.toISOString();
          if (!dateStr.includes('2026-09-04')) {
            return false;
          }
        } else if (filters._dateFilter === 'last_night') {
          const t = incDate.getTime();
          const startNight = new Date('2026-09-04T20:00:00').getTime();
          const endNight = new Date('2026-09-05T06:00:00').getTime();
          if (t < startNight || t > endNight) {
            return false;
          }
        }
      }
    }

    // 8. Track matching
    if (filters._trackFilter) {
      const tf = filters._trackFilter.toUpperCase();
      const rawNum = tf.replace('TRK#', '');
      const incTrk = (inc.trackId || (inc as any).track_id || '').toUpperCase();
      if (!incTrk.includes(tf) && !incTrk.includes(`TRACK-${rawNum}`) && incTrk !== rawNum) {
        return false;
      }
    }

    // 9. Suspicious behavior / Night movement matching
    if (filters._suspiciousType) {
      const st = filters._suspiciousType.toUpperCase();
      const incType = (inc.eventType || (inc as any).event_type || '').toUpperCase();
      const incReason = (inc.explainableReason || (inc as any).explainable_reason || '').toLowerCase();
      if (st === 'NIGHT_MOVEMENT_DETECTED') {
        const matches = incType.includes('NIGHT_MOVEMENT') || incReason.includes('night-time movement') || incReason.includes('night movement');
        if (!matches) return false;
      } else if (st === 'SUSPICIOUS') {
        const isSusp = incType.startsWith('SUSPICIOUS_') || incReason.includes('stationary') || incReason.includes('loiter') || incReason.includes('rapid movement') || incReason.includes('restricted zone');
        if (!isSusp) return false;
      } else {
        const matches = incType.includes(st) || (st === 'SUSPICIOUS_LOITERING' && incType.includes('LOITERING'));
        if (!matches) return false;
      }
    }


    return true;
  });
}
