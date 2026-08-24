import { ObjectType, EnvironmentCondition } from '../types';

export interface SmartAlertInput {
  rawConfidence: number; // 0-100%
  framesConfirmed: number;
  hasPersistentTrack: boolean;
  zoneBreached: boolean;
  objectType: ObjectType;
  loiteringSec: number;
  environmentalCondition: EnvironmentCondition;
  aiReliability: number;
}

export interface DecisionTraceStep {
  stepName: string;
  passed: boolean;
  details: string;
}

export interface SmartAlertDecision {
  isConfirmedAlert: boolean;
  decisionLabel: 'CONFIRMED HIGH ALERT' | 'SUPPRESSED FALSE ALARM' | 'FILTERED NOISE';
  reductionReason: string;
  traceSteps: DecisionTraceStep[];
  overallEfficiencyScore: number;
}

export function evaluateSmartAlert(input: SmartAlertInput): SmartAlertDecision {
  const traceSteps: DecisionTraceStep[] = [];
  let passedCount = 0;

  // Step 1: Raw Detection Confidence
  const step1Passed = input.rawConfidence >= 50;
  traceSteps.push({
    stepName: '1. Raw Detection Confidence',
    passed: step1Passed,
    details: `Confidence: ${input.rawConfidence}% (Min threshold 50%)`
  });
  if (step1Passed) passedCount++;

  // Step 2: Multi-Frame Temporal Confirmation
  const minFrames = input.environmentalCondition === 'dust' ? 30 : 15;
  const step2Passed = input.framesConfirmed >= minFrames;
  traceSteps.push({
    stepName: '2. Multi-Frame Confirmation',
    passed: step2Passed,
    details: `Confirmed across ${input.framesConfirmed} contiguous frames (Required ${minFrames}+)`
  });
  if (step2Passed) passedCount++;

  // Step 3: Persistent Tracking ID Check
  const step3Passed = input.hasPersistentTrack;
  traceSteps.push({
    stepName: '3. Persistent Tracking',
    passed: step3Passed,
    details: input.hasPersistentTrack ? 'Persistent Track ID assigned (#TRACK-8802)' : 'Unstable transient track'
  });
  if (step3Passed) passedCount++;

  // Step 4: Object Relevance Check
  const step4Passed = input.objectType === 'human' || input.objectType === 'vehicle' || input.objectType === 'group';
  traceSteps.push({
    stepName: '4. Object Relevance',
    passed: step4Passed,
    details: `Object Class: ${input.objectType.toUpperCase()} (${step4Passed ? 'High relevance threat class' : 'Filtered biological/dust'})`
  });
  if (step4Passed) passedCount++;

  // Step 5: Restricted Zone Analysis
  const step5Passed = input.zoneBreached;
  traceSteps.push({
    stepName: '5. Zone Analysis',
    passed: step5Passed,
    details: input.zoneBreached ? 'Restricted Zone Crossed (Zero-Tolerance)' : 'Outside restricted zone (Permitted buffer)'
  });
  if (step5Passed) passedCount++;

  // Step 6: Behavioural Analysis
  const step6Passed = input.loiteringSec > 10;
  traceSteps.push({
    stepName: '6. Behaviour Analysis',
    passed: step6Passed,
    details: `Loitering Duration: ${input.loiteringSec}s (${step6Passed ? 'Persistent stationary threat' : 'Transitory motion'})`
  });
  if (step6Passed) passedCount++;

  // Step 7: Environmental Confidence Validation
  const step7Passed = input.aiReliability >= 40;
  traceSteps.push({
    stepName: '7. Environmental Reliability',
    passed: step7Passed,
    details: `EnviroVision Reliability: ${input.aiReliability}% (${input.environmentalCondition.toUpperCase()})`
  });
  if (step7Passed) passedCount++;

  // Final Decision
  const isConfirmedAlert = step1Passed && step2Passed && step3Passed && step4Passed && (step5Passed || step6Passed);

  let decisionLabel: 'CONFIRMED HIGH ALERT' | 'SUPPRESSED FALSE ALARM' | 'FILTERED NOISE' = 'CONFIRMED HIGH ALERT';
  let reductionReason = 'Target validated through multi-frame temporal tracking and restricted zone crossing.';

  if (!isConfirmedAlert) {
    if (!step2Passed || !step3Passed) {
      decisionLabel = 'FILTERED NOISE';
      reductionReason = 'Suppressed: Single-frame transient noise detection / shadow flicker.';
    } else if (input.objectType === 'animal') {
      decisionLabel = 'SUPPRESSED FALSE ALARM';
      reductionReason = 'Suppressed: Biological non-threat movement (wildlife/cattle).';
    } else {
      decisionLabel = 'SUPPRESSED FALSE ALARM';
      reductionReason = 'Suppressed: Outside restricted area without loitering behaviour.';
    }
  }

  return {
    isConfirmedAlert,
    decisionLabel,
    reductionReason,
    traceSteps,
    overallEfficiencyScore: Math.round((passedCount / 7) * 100)
  };
}
