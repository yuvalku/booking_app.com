# backend/main.py
from datetime import date, datetime, timedelta
import os
from enum import Enum
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import Column, Date, DateTime, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

import smtplib
from email.mime.text import MIMEText

# --- config & DB engine ---
load_dotenv()

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "changeme")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

# Use Neon Postgres in prod (DATABASE_URL), fallback to local SQLite in dev
DB_URL = os.getenv("DATABASE_URL", "sqlite:///./family_bookings.db")

engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {},
    pool_pre_ping=True,  # helpful for serverless Postgres (Neon)
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()

# --- FastAPI app + CORS ---
app = FastAPI(title="Family Apartment Booking")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN] if FRONTEND_ORIGIN != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Email Config ---
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "youraddress@gmail.com")
SENDER_PASS = os.getenv("SENDER_PASS", "app_password")  # Gmail App Password
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "yuvalspam765@gmail.com")

def send_email(to_email: str, subject: str, body: str):
    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_email

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(SENDER_EMAIL, SENDER_PASS)
        server.send_message(msg)

# --- DB Model ---
class Booking(Base):
    __tablename__ = "bookings"
    id = Column(Integer, primary_key=True)
    requester_name = Column(String, nullable=False)
    requester_email = Column(String, nullable=False)
    start_date = Column(Date, nullable=False) 
    end_date = Column(Date, nullable=False)   
    status = Column(String, default="pending", nullable=False)  # pending/approved/rejected/cancelled
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    decision_at = Column(DateTime, nullable=True)
    decided_by = Column(String, nullable=True)

# create tables if they don't exist
Base.metadata.create_all(engine)

# --- DI session ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Schemas ---
class Status(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"

class BookingIn(BaseModel):
    requester_name: str
    requester_email: EmailStr
    start_date: date     
    end_date: date       
    notes: Optional[str] = None

    @field_validator("end_date")
    @classmethod
    def check_range(cls, v, info):
        start = info.data.get("start_date")
        if start and v <= start:
            raise ValueError("end_date must be after start_date (checkout day).")
        return v

class BookingOut(BaseModel):
    id: int
    requester_name: str
    requester_email: Optional[str]
    start_date: date
    end_date: date
    status: Status
    notes: Optional[str]

    class Config:
        from_attributes = True  # pydantic v2

# class CancelIn(BaseModel):
#     reason: Optional[str] = None

# --- helpers ---
def overlaps(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    
    return (a_end > b_start) and (b_end > a_start)

def require_admin(secret: Optional[str]):
    expected = (ADMIN_SECRET or "").strip()
    got = (secret or "").strip()
    if got != expected:
        raise HTTPException(status_code=401, detail="Unauthorized (bad admin secret)")

def cleanup_old_requests(db: Session):
    cutoff = datetime.utcnow() - timedelta(days=15)
    db.query(Booking).filter(
        Booking.status.in_(["cancelled", "rejected"]),
        Booking.decision_at < cutoff
    ).delete(synchronize_session=False)
    db.commit()

# --- routes ---
@app.api_route("/api/health" ,methods=["GET", "HEAD"])
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}

@app.get("/api/admin/verify")
def admin_verify(x_admin_secret: Optional[str] = Header(default=None, alias="X-Admin-Secret")):
    require_admin(x_admin_secret)
    return {"ok": True}

@app.post("/api/requests", response_model=BookingOut)
def create_request(
    payload: BookingIn,
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
):
    row = Booking(
        requester_name=payload.requester_name.strip(),
        requester_email=(payload.requester_email or None),
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="pending",
        notes=(payload.notes or None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # ---- Email notification ----
    if background_tasks:
        subject = f"🔔 New Booking Request from {row.requester_name}"
        body = (
            f"A new booking request has been submitted.\n\n"
            f"Name: {row.requester_name}\n"
            f"Email: {row.requester_email}\n"
            f"Dates: {row.start_date} → {row.end_date}\n"
            f"Notes: {row.notes or '-'}\n"
            f"Status: {row.status}\n\n"
            f"For managing requests: https://booking-app-com.onrender.com\n"
        )
        background_tasks.add_task(send_email, NOTIFY_EMAIL, subject, body)

    return row

@app.get("/api/requests", response_model=List[BookingOut])
def list_requests(
    status: Optional[Status] = Query(default=None),
    active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
    x_admin_secret: Optional[str] = Header(default=None, alias="X-Admin-Secret"),
):
    require_admin(x_admin_secret)  # only admin can see requests
    q = db.query(Booking)
    if active:
        q = q.filter(Booking.status.in_(("pending", "approved")))
    elif status:
        q = q.filter(Booking.status == status.value)
    return q.order_by(Booking.start_date.asc(), Booking.id.asc()).all()

@app.get("/api/bookings/approved", response_model=List[BookingOut])
def approved_bookings(db: Session = Depends(get_db)):
    return (
        db.query(Booking)
        .filter(Booking.status == "approved")
        .order_by(Booking.start_date.asc(), Booking.id.asc())
        .all()
    )

@app.post("/api/requests/{req_id}/approve", response_model=BookingOut)
def approve_request(
    req_id: int,
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
    x_admin_secret: Optional[str] = Header(default=None, alias="X-Admin-Secret"),
):
    require_admin(x_admin_secret)

    row = db.get(Booking, req_id)
    if not row:
        raise HTTPException(404, "Request not found")
    if row.status != "pending":
        raise HTTPException(409, f"Cannot approve request in status {row.status}")

    conflicts = (
        db.query(Booking)
        .filter(Booking.status == "approved")
        .filter(Booking.end_date > row.start_date)
        .filter(Booking.start_date < row.end_date)
        .all()
    )
    if conflicts:
        raise HTTPException(409, "Date conflict with an existing approved booking")

    row.status = "approved"
    row.decision_at = datetime.utcnow()
    row.decided_by = "Mom"
    db.commit()
    db.refresh(row)

    # ✉️ Notify requester
    if background_tasks:
        subject = "🎉 Your booking has been approved"
        body = (
            f"Hi {row.requester_name},\n\n"
            f"Your booking request for {row.start_date} → {row.end_date} has been approved.\n"
        )
        background_tasks.add_task(send_email, row.requester_email, subject, body)

    return row

@app.post("/api/requests/{req_id}/reject", response_model=BookingOut)
def reject_request(
    req_id: int,
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
    x_admin_secret: Optional[str] = Header(default=None, alias="X-Admin-Secret"),
):
    require_admin(x_admin_secret)

    row = db.get(Booking, req_id)
    if not row:
        raise HTTPException(404, "Request not found")
    if row.status != "pending":
        raise HTTPException(409, f"Cannot reject request in status {row.status}")

    row.status = "rejected"
    row.decision_at = datetime.utcnow()
    row.decided_by = "Mom"
    db.commit()
    db.refresh(row)

    # ✉️ Notify requester
    if background_tasks:
        subject = "❌ Your booking has been rejected"
        body = (
            f"Hi {row.requester_name},\n\n"
            f"Your booking request for {row.start_date} → {row.end_date} has been rejected.\n"
        )
        background_tasks.add_task(send_email, row.requester_email, subject, body)
        
    return row

@app.post("/api/requests/{req_id}/cancel", response_model=BookingOut)
def cancel_request(
    req_id: int,
    # payload: CancelIn | None = None,
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
    x_admin_secret: Optional[str] = Header(default=None, alias="X-Admin-Secret"),
):
    require_admin(x_admin_secret)

    row = db.get(Booking, req_id)
    if not row:
        raise HTTPException(404, "Request not found")
    if row.status != "approved":
        raise HTTPException(409, f"Only approved bookings can be cancelled (current: {row.status})")

    row.status = "cancelled"
    row.decision_at = datetime.utcnow()
    row.decided_by = "Mom"
    # if payload and payload.reason:
    #     row.notes = (row.notes or "") + f"\n[Cancelled]: {payload.reason}"
    db.commit()
    db.refresh(row)

    # ✉️ Notify requester
    if background_tasks:
        subject = "⚠️ Your booking has been cancelled"
        body = (
            f"Hi {row.requester_name},\n\n"
            f"Your booking request for {row.start_date} → {row.end_date} has been cancelled.\n"
        )
        background_tasks.add_task(send_email, row.requester_email, subject, body)
        
    return row

@app.on_event("startup")
def startup_cleanup():
    db = SessionLocal()
    try:
        cleanup_old_requests(db)
        print("✅ Startup cleanup complete")
    except Exception as e:
        print(f"❌ Startup cleanup error: {e}")
    finally:
        db.close()