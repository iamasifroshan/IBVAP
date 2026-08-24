import { ObjectType, EnvironmentCondition, ThreatFactor } from '../types';

export interface ThreatCalculationInput {
  objectType: ObjectType;
  zoneBreached: boolean;
  zoneType?: 'restricted_fence' | 'buffer_zone' | 'outpost_perimeter';
  timeHourUtc: number; // 0-23
  loiteringDurationSec: number;
  directionInward: boolean;
  repeatedApproachCount: number;
  multiFrameConfirmed: boolean;
  rawConfidence: number; // 0-100%
  aiReliability: number; // 0-100%
  environmentalCondition: EnvironmentCondition;
}

export interface ThreatCalculationResult {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: ThreatFactor[];
  explainableSentence: string;
  recommendedAction: string;
  positiveAdjustments: number;
  negativeAdjustments: number;
  environmentalPenalty: number;
}

export function calculateBorderThreat(input: ThreatCalculationInput): ThreatCalculationResult {
  const factors: ThreatFactor[] = [];
  let totalScore = 0;
  let positiveAdjustments = 0;
  let negativeAdjustments = 0;
  let environmentalPenalty = 0;

  // 1. Object Type Base Weight
  let objectScore = 10;
  let objectDesc = 'Unknown target detected';
  if (input.objectType === 'human') {
    objectScore = 20;
    objectDesc = 'Human target class identified';
  } else if (input.objectType === 'group') {
    objectScore = 35;
    objectDesc = 'Group intrusion (3+ individuals) identified';
  } else if (input.objectType === 'vehicle') {
    objectScore = 30;
    objectDesc = 'Unregistered vehicle target identified';
  } else if (input.objectType === 'animal') {
    objectScore = 5;
    objectDesc = 'Biological quadruped (non-threat biological)';
  }
  factors.push({ category: 'Object Classification', scoreContribution: objectScore, description: objectDesc });
  totalScore += objectScore;
  positiveAdjustments += objectScore;

  // 2. Restricted Zone Crossing
  if (input.zoneBreached) {
    let zoneScore = 35;
    if (input.zoneType === 'restricted_fence') zoneScore = 40;
    else if (input.zoneType === 'buffer_zone') zoneScore = 25;

    factors.push({ 
      category: 'Restricted Zone Breach', 
      scoreContribution: zoneScore, 
      description: `Direct crossing into ${input.zoneType || 'Zero-Tolerance Restricted Area'}` 
    });
    totalScore += zoneScore;
    positiveAdjustments += zoneScore;
  }

  // 3. Time of Day (Restricted Night Hours 22:00 - 04:00 UTC)
  if (input.timeHourUtc >= 22 || input.timeHourUtc <= 4) {
    const timeScore = 15;
    factors.push({ 
      category: 'Restricted Hours Vector', 
      scoreContribution: timeScore, 
      description: `Perimeter activity during dark hours (${input.timeHourUtc}:00 UTC)` 
    });
    totalScore += timeScore;
    positiveAdjustments += timeScore;
  }

  // 4. Direction of Movement (Inward Towards Outpost)
  if (input.directionInward) {
    const dirScore = 12;
    factors.push({ 
      category: 'Direction Vector', 
      scoreContribution: dirScore, 
      description: 'Trajectory vector aligned inward toward inner outpost infrastructure' 
    });
    totalScore += dirScore;
    positiveAdjustments += dirScore;
  }

  // 5. Loitering Duration
  if (input.loiteringDurationSec > 10) {
    const loiterScore = Math.min(20, Math.floor(input.loiteringDurationSec / 3));
    factors.push({ 
      category: 'Loitering Duration', 
      scoreContribution: loiterScore, 
      description: `Stationary loitering maintained for ${input.loiteringDurationSec} seconds` 
    });
    totalScore += loiterScore;
    positiveAdjustments += loiterScore;
  }

  // 6. Repeated Approach Attempts
  if (input.repeatedApproachCount > 1) {
    const repeatScore = Math.min(15, input.repeatedApproachCount * 5);
    factors.push({ 
      category: 'Repeated Boundary Approach', 
      scoreContribution: repeatScore, 
      description: `Target re-approached perimeter boundary ${input.repeatedApproachCount} times` 
    });
    totalScore += repeatScore;
    positiveAdjustments += repeatScore;
  }

  // 7. Multi-frame Confirmation (SmartAlert Verification)
  if (input.multiFrameConfirmed) {
    const smartAlertScore = 8;
    factors.push({ 
      category: 'SmartAlert Confirmation', 
      scoreContribution: smartAlertScore, 
      description: 'Multi-frame tracking persistent ID confirmed (120+ frames)' 
    });
    totalScore += smartAlertScore;
    positiveAdjustments += smartAlertScore;
  }

  // 8. Environmental Reliability Penalty (EnviroVision Multiplier)
  if (input.aiReliability < 70) {
    environmentalPenalty = Math.round((70 - input.aiReliability) * 0.25);
    factors.push({ 
      category: 'Environmental Reliability Penalty', 
      scoreContribution: -environmentalPenalty, 
      description: `${input.environmentalCondition.toUpperCase()} condition reduced AI reliability to ${input.aiReliability}%` 
    });
    totalScore -= environmentalPenalty;
    negativeAdjustments += environmentalPenalty;
  }

  // Clamp totalScore between 0 and 100
  totalScore = Math.max(0, Math.min(100, totalScore));

  // Determine Level
  let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
  let recommendedAction = 'Log event in EdgeGuard storage. Standard monitoring.';

  if (totalScore >= 80) {
    level = 'critical';
    recommendedAction = 'IMMEDIATE OPERATOR ACTION: Dispatch Quick Reaction Force (QRF), activate sirens & spotlight.';
  } else if (totalScore >= 60) {
    level = 'high';
    recommendedAction = 'HIGH PRIORITY: Monitor active camera feed, notify sector commander, prepare perimeter QRF.';
  } else if (totalScore >= 30) {
    level = 'medium';
    recommendedAction = 'MEDIUM PRIORITY: Keep automated tracking active. Operator verification recommended.';
  }

  // Build Explainable Sentence
  const explainableSentence = `${input.objectType.toUpperCase()} target generated Threat Score ${totalScore}/100 (${level.toUpperCase()}). Key factors: ${
    input.zoneBreached ? 'Restricted Zone Breach (+40)' : ''
  } ${input.timeHourUtc >= 22 || input.timeHourUtc <= 4 ? ', Restricted Night Hours (+15)' : ''} ${
    input.loiteringDurationSec > 10 ? `, Loitering ${input.loiteringDurationSec}s` : ''
  }.`;

  return {
    score: totalScore,
    level,
    factors,
    explainableSentence,
    recommendedAction,
    positiveAdjustments,
    negativeAdjustments,
    environmentalPenalty
  };
}
