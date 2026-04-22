import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import cv
from app.routers import settings as settings_router
from app.routers.agent import router as agent_router
from app.routers.profiles import router as profiles_router

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

# Set of currently connected WebSocket clients.  We use a plain set so
# cleanup on disconnect is O(1).
_ws_clients: set[WebSocket] = set()


async def broadcast(event: dict) -> None:
    """Send *event* as JSON to all connected WebSocket clients.

    Clients that have already disconnected are silently removed from the
    active set so they don't block future broadcasts.
    """
    dead: set[WebSocket] = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)

    _ws_clients.difference_update(dead)


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_db()
    yield


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="JobTY API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(profiles_router, prefix="/profiles")
app.include_router(cv.router, prefix="/cv", tags=["cv"])
app.include_router(agent_router, prefix="/agent")
app.include_router(settings_router.router, prefix="/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Static endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# WebSocket live feed
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket live feed for bot events.

    Clients connect here and receive JSON messages for every significant
    step the agent takes:

        {"type": "job_found"|"job_scored"|"applied"|"skipped"|"error"|"status",
         "data": {...},
         "timestamp": "<ISO-8601>"}
    """
    await websocket.accept()
    _ws_clients.add(websocket)
    logger.debug("WebSocket client connected — total=%d", len(_ws_clients))

    try:
        # Keep the connection alive by listening for client messages.
        # We don't process inbound messages; this loop just blocks until
        # the client disconnects.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("WebSocket error (client likely closed): %s", exc)
    finally:
        _ws_clients.discard(websocket)
        logger.debug(
            "WebSocket client disconnected — total=%d", len(_ws_clients)
        )
