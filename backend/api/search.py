import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from database.db import get_db
from database.schemas import SearchQueryRequest, SearchQueryResponse, IncidentResponse
from database.models import IncidentModel
from api.incidents import map_incident_to_response

router = APIRouter(prefix="/search", tags=["Search"])

# Operational reference date for temporal queries (05 Sept 2026)
REFERENCE_DATETIME = datetime(2026, 9, 5, 12, 0, 0)


def parse_officer_nlp_query(query_text: str) -> Dict[str, Any]:
    q = (query_text or "").lower().strip()
    if not q:
        return {
            "rawQuery": query_text,
            "intentSummary": "Please enter a search query to investigate incidents.",
            "extractedObject": "Any Target",
            "extractedCamera": "All Cameras",
            "extractedSector": "All Sectors",
            "extractedTimeRange": "All Stored Timestamps",
            "extractedThreat": "All Scores",
            "extractedEnvironment": "Any",
            "extractedEventType": "Security Incident",
            "validated": False,
            "confidence": 0.0,
            "recognizedSlots": [],
            "missingSlots": ["Object", "Location/Sector", "Time Window"],
            "_filters": {}
        }

    # 1. Object Extraction
    obj = None
    if re.search(r'\b(people|person|human|humans|pedestrian|pedestrians|intruder|intruders|man|men|woman|women)\b', q):
        obj = 'human'
    elif re.search(r'\b(vehicle|vehicles|car|cars|truck|trucks|jeep|jeeps|4x4|suv|suvs|bike|bikes|motor)\b', q):
        obj = 'vehicle'
    elif re.search(r'\b(drone|drones|uav|quadcopter)\b', q):
        obj = 'drone'
    elif re.search(r'\b(animal|animals|cattle|livestock|wildlife)\b', q):
        obj = 'animal'
    elif re.search(r'\b(group|multiple|crowd)\b', q):
        obj = 'group'
    elif re.search(r'\bany\b', q):
        obj = 'any'

    # 2. Camera Extraction
    cam = None
    cam_match = re.search(r'\b(?:camera|cam)\s*(\d+|[a-z0-9\-]+)\b', q)
    if cam_match:
        cam_val = cam_match.group(1).upper()
        if cam_val in ('7', '07'):
            cam = 'BORDER-CAM-07'
        elif cam_val in ('3', '03'):
            cam = 'SECTOR-B-CAM-03'
        elif cam_val in ('2', '02'):
            cam = 'BOP-NORTH-02'
        elif cam_val in ('4', '04'):
            cam = 'EAST-PERIM-04'
        elif cam_val in ('10',):
            cam = 'SOUTH-TRENCH-10'
        else:
            cam = f"CAM-{cam_val}"
    elif 'checkpoint cam' in q:
        cam = 'BOP-NORTH-02'
    elif 'border cam' in q or 'border camera' in q:
        cam = 'BORDER-CAM-07'

    # 3. Sector & Outpost Extraction (Check named landmarks first!)
    sector = None
    outpost = None
    if re.search(r'\b(northern checkpoint|checkpoint)\b', q):
        sector = 'Sector A'
        outpost = 'Northern Checkpoint'
    elif re.search(r'\b(eastern|east sector|east perimeter)\b', q):
        sector = 'Eastern Perimeter'
    elif re.search(r'\b(southern|south sector|south perimeter)\b', q):
        sector = 'South Perimeter'
    else:
        sec_match = re.search(r'\bsector\s+([a-z0-9]+)\b', q)
        if sec_match:
            sector = f"Sector {sec_match.group(1).upper()}"

    # 4. Threat Level & Min Score
    threat_level = None
    min_score = None
    if 'critical' in q:
        threat_level = 'critical'
        min_score = 80
    elif 'high-risk' in q or 'high risk' in q or 'high' in q:
        threat_level = 'high'
        min_score = 60
    elif 'medium' in q:
        threat_level = 'medium'
        min_score = 40
    elif 'low' in q:
        threat_level = 'low'
        min_score = 20

    score_match = re.search(r'\b(?:above|greater than|>|score above)\s*(\d+)\b', q)
    if score_match:
        min_score = int(score_match.group(1))

    # 5. Environment
    env = None
    if re.search(r'\b(fog|foggy|mist|haze)\b', q):
        env = 'fog'
    elif re.search(r'\b(at night|during night|night condition|in the dark)\b', q):
        env = 'night'
    elif re.search(r'\b(rain|rainy|raining|downpour)\b', q):
        env = 'rain'
    elif re.search(r'\bdust\b', q):
        env = 'dust'

    # 6. Date & Time Window
    date_filter = None
    start_hour = None
    end_hour = None
    time_display = 'All Stored Timestamps'

    if 'yesterday' in q:
        date_filter = (REFERENCE_DATETIME - timedelta(days=1)).strftime('%Y-%m-%d')
    elif 'today' in q:
        date_filter = REFERENCE_DATETIME.strftime('%Y-%m-%d')
    elif 'last night' in q:
        date_filter = 'last_night'
        time_display = 'Restricted Night Hours (20:00 – 06:00 IST)'

    if '10 pm and midnight' in q or ('10 pm' in q and 'midnight' in q):
        time_display = '22:00 – 00:00 IST'
        start_hour, end_hour = 22, 24
    elif 'after 2 am' in q or '2 am' in q:
        time_display = '02:00 – 06:00 IST (Post-Curfew)'
        start_hour, end_hour = 2, 6
    elif 'after 10 pm' in q:
        time_display = '22:00 – 23:59 IST'
        start_hour, end_hour = 22, 24

    # 7. Event Type
    event_type = 'Security Incident'
    if re.search(r'\b(intrusion|breach|trespass|crossed|crossing)\b', q):
        event_type = 'Restricted Zone Breach'
    elif 'loitering' in q:
        event_type = 'Loitering Event'
    elif 'vehicle' in q:
        event_type = 'Vehicle Movement'
    elif 'people' in q or 'human' in q:
        event_type = 'Human Detection'

    # Recognized Slots summary
    recognized_slots = []
    if obj: recognized_slots.append(f"Object: {obj.capitalize()}")
    if cam: recognized_slots.append(f"Camera: {cam}")
    if sector: recognized_slots.append(f"Sector: {sector}")
    if threat_level: recognized_slots.append(f"Threat: {threat_level.capitalize()}")
    if env: recognized_slots.append(f"Environment: {env.capitalize()}")
    if date_filter: recognized_slots.append(f"Date: {'Yesterday' if 'yesterday' in q else date_filter}")
    if start_hour is not None or 'last night' in q: recognized_slots.append(f"Time: {time_display}")

    validated = len(recognized_slots) > 0
    confidence = round(min(95.4, 65.0 + (len(recognized_slots) * 5.8)), 1) if validated else 0.0

    missing_slots = []
    if not obj: missing_slots.append("Object / Target Class")
    if not (sector or cam): missing_slots.append("Sector or Camera Location")
    if start_hour is None and not date_filter: missing_slots.append("Time Range / Date")

    intent_parts = []
    if obj: intent_parts.append(f"{obj} targets")
    else: intent_parts.append("all target types")
    if sector: intent_parts.append(f"in {sector}")
    if outpost: intent_parts.append(f"near {outpost}")
    if cam: intent_parts.append(f"on {cam}")
    if time_display != "All Stored Timestamps": intent_parts.append(f"({time_display})")
    if threat_level: intent_parts.append(f"with {threat_level.upper()} threat")
    if env: intent_parts.append(f"during {env}")

    intent_summary = f"Retrieve real records for {' '.join(intent_parts)} from database." if validated else "Query could not be parsed into recognized border security operational parameters."

    return {
        "rawQuery": query_text,
        "intentSummary": intent_summary,
        "extractedObject": obj.capitalize() if obj else "Any Target",
        "extractedCamera": cam or "All Cameras",
        "extractedSector": sector or "All Sectors",
        "extractedTimeRange": time_display,
        "extractedThreat": threat_level.capitalize() if threat_level else "All Scores",
        "extractedEnvironment": env.capitalize() if env else "Any",
        "extractedEventType": event_type,
        "validated": validated,
        "confidence": confidence,
        "recognizedSlots": recognized_slots,
        "missingSlots": missing_slots,
        "_filters": {
            "obj": obj,
            "cam": cam,
            "sector": sector,
            "outpost": outpost,
            "threat_level": threat_level,
            "min_score": min_score,
            "env": env,
            "date_filter": date_filter,
            "start_hour": start_hour,
            "end_hour": end_hour,
        }
    }


@router.post("/query", response_model=SearchQueryResponse)
def search_query(req: SearchQueryRequest, db: Session = Depends(get_db)):
    parsed = parse_officer_nlp_query(req.query)
    
    # If query could not be validated at all, return empty results with diagnostics
    if not parsed["validated"]:
        return SearchQueryResponse(
            filters=parsed,
            results=[]
        )

    f = parsed["_filters"]
    query = db.query(IncidentModel)

    # 1. Object filter
    if f["obj"] and f["obj"] != "any":
        query = query.filter(IncidentModel.object_type == f["obj"])

    # 2. Camera filter
    if f["cam"]:
        query = query.filter(
            or_(
                IncidentModel.camera_id == f["cam"],
                IncidentModel.camera_name == f["cam"]
            )
        )

    # 3. Sector / Outpost filter
    if f["sector"]:
        query = query.filter(IncidentModel.sector == f["sector"])
    if f["outpost"]:
        query = query.filter(IncidentModel.outpost == f["outpost"])

    # 4. Threat level / min score
    if f["threat_level"] == "critical":
        query = query.filter(IncidentModel.threat_level == "critical")
    elif f["threat_level"] == "high":
        query = query.filter(
            or_(
                IncidentModel.threat_level == "high",
                IncidentModel.threat_level == "critical"
            )
        )
    elif f["min_score"] is not None:
        query = query.filter(IncidentModel.threat_score >= f["min_score"])

    # 5. Environment
    if f["env"]:
        query = query.filter(IncidentModel.environment == f["env"])

    # 6. Date filter
    if f["date_filter"]:
        if f["date_filter"] == "last_night":
            query = query.filter(
                and_(
                    IncidentModel.timestamp >= datetime(2026, 9, 4, 20, 0, 0),
                    IncidentModel.timestamp <= datetime(2026, 9, 5, 6, 0, 0)
                )
            )
        else:
            # Match date prefix (YYYY-MM-DD)
            day_start = datetime.strptime(f["date_filter"], "%Y-%m-%d")
            day_end = day_start + timedelta(days=1)
            query = query.filter(
                and_(
                    IncidentModel.timestamp >= day_start,
                    IncidentModel.timestamp < day_end
                )
            )

    # Order by timestamp descending (newest first)
    query = query.order_by(IncidentModel.timestamp.desc())
    all_matched = query.all()

    # In-memory hour filtering if specific hours were extracted
    results_list = []
    start_hour = f["start_hour"]
    end_hour = f["end_hour"]

    for inc in all_matched:
        if start_hour is not None and end_hour is not None:
            inc_time = inc.timestamp
            if inc_time:
                hour = inc_time.hour
                if not (start_hour <= hour < end_hour):
                    continue
        results_list.append(map_incident_to_response(inc))

    # Clean out internal _filters before returning
    public_filters = {k: v for k, v in parsed.items() if k != "_filters"}

    return SearchQueryResponse(
        filters=public_filters,
        results=results_list
    )
