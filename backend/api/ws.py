import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                dead_connections.append(connection)
        for dc in dead_connections:
            if dc in self.active_connections:
                self.active_connections.remove(dc)

manager = ConnectionManager()

main_loop = None

@router.websocket("/ws/detections")
async def websocket_endpoint(websocket: WebSocket):
    global main_loop
    try:
        main_loop = asyncio.get_running_loop()
    except Exception:
        pass
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

def broadcast_event_sync(event_type: str, payload: dict):
    """
    Sync helper to broadcast events from regular sync routes or background threads.
    """
    message = json.dumps({"type": event_type, "payload": payload}, default=str)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message))
        return
    except RuntimeError:
        pass

    global main_loop
    if main_loop and main_loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(manager.broadcast(message), main_loop)
        except Exception:
            pass

