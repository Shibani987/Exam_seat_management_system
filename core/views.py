from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.contrib.auth.decorators import login_required
from datetime import datetime, timedelta, date, time
from django.utils import timezone
from django.core.mail import send_mail
from django.conf import settings
from django.db.models import Q
import secrets
import string
import logging
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.shortcuts import render, redirect

import pandas as pd
import json
import re
from django.contrib.auth.hashers import make_password, check_password
import traceback
from pathlib import Path
from django.db import transaction, IntegrityError
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont

# Setup logging for security events
logger = logging.getLogger('exam_system')

ATTENDANCE_SHEET_STUDENTS_PER_PAGE = 20

PDF_DPI = 300
MM_TO_PX = PDF_DPI / 25.4
A4_WIDTH_PX = int(round(210 * MM_TO_PX))
A4_HEIGHT_PX = int(round(297 * MM_TO_PX))
LOGO_PATH_CANDIDATES = (
    settings.BASE_DIR / "static" / "core" / "img" / "logo.png",
    settings.BASE_DIR / "staticfiles" / "core" / "img" / "logo.png",
)
FONT_CANDIDATES = {
    "regular": (
        Path("C:/Windows/Fonts/times.ttf"),
        Path("C:/Windows/Fonts/georgia.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ),
    "bold": (
        Path("C:/Windows/Fonts/timesbd.ttf"),
        Path("C:/Windows/Fonts/georgiab.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ),
}

from .forms import StudentDataUploadForm, ForgotPasswordForm, ResetPasswordForm, AdminEmailUploadForm
from .models import (
    StudentDataFile,
    Student,
    DepartmentExam,
    Exam,
    Room,
    ExamStudent,
    SeatAllocation,
    AttendanceSheet,
    MarksSheet,
    AdminAccount,
    EligibleAdminEmail,
    BlockedAdminEmail,
    PasswordResetToken,
)
from .config import AppConfig

# =========================
# Admin Credentials (from OOP config)
# =========================

_admin_creds = AppConfig.get_admin_credentials()
ENV_ADMIN_USERNAME = _admin_creds.username
ENV_ADMIN_PASSWORD = _admin_creds.password


def _mm(value):
    return int(round(value * MM_TO_PX))


def _sanitize_download_filename(value, fallback="attendance-sheet"):
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "").strip()).strip("._-")
    return cleaned or fallback


def _load_attendance_font(size, bold=False):
    key = "bold" if bold else "regular"
    for font_path in FONT_CANDIDATES[key]:
        if font_path.exists():
            return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


def _attendance_logo_image():
    for logo_path in LOGO_PATH_CANDIDATES:
        if logo_path.exists():
            return Image.open(logo_path).convert("RGBA")
    return None


def _draw_centered_text(draw, box, text, font, fill="black"):
    left, top, right, bottom = box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = left + ((right - left) - text_width) / 2
    y = top + ((bottom - top) - text_height) / 2
    draw.text((x, y), text, font=font, fill=fill)


def _draw_text(draw, xy, text, font, fill="black", anchor=None):
    kwargs = {"font": font, "fill": fill}
    if anchor:
        kwargs["anchor"] = anchor
    draw.text(xy, text, **kwargs)


def _draw_attendance_sheet_page(page_meta, exam_name, fonts, logo):
    image = Image.new("RGB", (A4_WIDTH_PX, A4_HEIGHT_PX), "white")
    draw = ImageDraw.Draw(image)

    margin_x = _mm(6)
    top_margin = _mm(5)
    content_left = margin_x
    content_right = A4_WIDTH_PX - margin_x

    regular_30 = fonts["regular_30"]
    regular_34 = fonts["regular_34"]
    regular_36 = fonts["regular_36"]
    regular_40 = fonts["regular_40"]
    bold_34 = fonts["bold_34"]
    bold_38 = fonts["bold_38"]
    bold_42 = fonts["bold_42"]
    bold_46 = fonts["bold_46"]
    bold_48 = fonts["bold_48"]
    bold_54 = fonts["bold_54"]
    bold_64 = fonts["bold_64"]

    if page_meta.get("room_number"):
        room_box = (content_right - _mm(36), top_margin + _mm(1), content_right, top_margin + _mm(13))
        draw.rectangle(room_box, outline="black", width=2)
        _draw_centered_text(draw, room_box, f"Room {str(page_meta['room_number']).upper()}", bold_38)

    if logo:
        logo_size = _mm(24)
        logo_left = content_left + _mm(8)
        logo_top = top_margin + _mm(2)
        logo_resized = logo.resize((logo_size, logo_size))
        image.paste(logo_resized, (logo_left, logo_top), logo_resized)

    header_center_x = (content_left + content_right) // 2
    _draw_text(draw, (header_center_x, top_margin + _mm(6)), "CONTROLLER OF EXAMINATIONS", bold_64, anchor="ma")
    _draw_text(draw, (header_center_x, top_margin + _mm(14)), "JIS COLLEGE OF ENGINEERING", bold_46, anchor="ma")
    _draw_text(draw, (header_center_x, top_margin + _mm(20)), "AN AUTONOMOUS INSTITUTE UNDER MAKAUT, W.B.", regular_34, anchor="ma")
    _draw_text(draw, (header_center_x, top_margin + _mm(29)), f"Attendance Sheet for {exam_name}", bold_42, anchor="ma")

    meta_top = top_margin + _mm(33)
    meta_height = _mm(11)
    left_meta_width = _mm(58)
    right_meta_width = _mm(48)
    right_meta_right = content_right - _mm(26)
    right_meta_left = right_meta_right - right_meta_width

    left_boxes = [
        (content_left, meta_top, content_left + left_meta_width, meta_top + meta_height, "Date of Examination"),
        (content_left, meta_top + meta_height + _mm(1.5), content_left + left_meta_width, meta_top + (meta_height * 2) + _mm(1.5), "Paper Name"),
    ]
    right_boxes = [
        (right_meta_left, meta_top, right_meta_right, meta_top + meta_height, "Time"),
        (right_meta_left, meta_top + meta_height + _mm(1.5), right_meta_right, meta_top + (meta_height * 2) + _mm(1.5), "Paper Code"),
    ]
    for left, top, right, bottom, label in left_boxes + right_boxes:
        draw.rectangle((left, top, right, bottom), outline="black", width=2)
        _draw_centered_text(draw, (left, top, right, bottom), label, regular_30)

    table_top = top_margin + _mm(58)
    table_bottom = top_margin + _mm(235)
    table_width = content_right - content_left
    col_widths = [_mm(9), _mm(46), _mm(39), _mm(31), _mm(33)]
    remaining = table_width - sum(col_widths)
    col_widths.append(remaining)
    col_lefts = [content_left]
    for width in col_widths[:-1]:
        col_lefts.append(col_lefts[-1] + width)
    col_rights = [left + width for left, width in zip(col_lefts, col_widths)]

    header_height = _mm(11)
    row_height = int((table_bottom - table_top - header_height) / ATTENDANCE_SHEET_STUDENTS_PER_PAGE)

    draw.rectangle((content_left, table_top, content_right, table_bottom), outline="black", width=2)
    headers = [
        "SL.",
        "STUDENT NAME",
        "UNIVERSITY REG.\nNUMBER",
        "COLLEGE ROLL\nNUMBER",
        "ANSWER BOOKLET\nNUMBER",
        "CANDIDATE\nSIGNATURE",
    ]

    for idx, header in enumerate(headers):
        left = col_lefts[idx]
        right = col_rights[idx]
        if idx > 0:
            draw.line((left, table_top, left, table_bottom), fill="black", width=2)
        header_box = (left, table_top, right, table_top + header_height)
        lines = header.split("\n")
        if len(lines) == 1:
            _draw_centered_text(draw, header_box, lines[0], bold_34)
        else:
            midpoint_y = (header_box[1] + header_box[3]) / 2
            _draw_text(draw, ((left + right) / 2, midpoint_y - _mm(2.5)), lines[0], bold_34, anchor="ma")
            _draw_text(draw, ((left + right) / 2, midpoint_y + _mm(2.5)), lines[1], bold_34, anchor="ma")

    draw.line((content_left, table_top + header_height, content_right, table_top + header_height), fill="black", width=2)

    students = (page_meta.get("students") or [])[:ATTENDANCE_SHEET_STUDENTS_PER_PAGE]
    cell_padding = _mm(2)
    for row_index in range(ATTENDANCE_SHEET_STUDENTS_PER_PAGE):
        row_top = table_top + header_height + (row_index * row_height)
        row_bottom = row_top + row_height
        draw.line((content_left, row_bottom, content_right, row_bottom), fill="black", width=2)

        student = students[row_index] if row_index < len(students) else {}
        values = [
            f"{row_index + 1}." if any((student or {}).get(key) for key in ("name", "registration_number", "roll_number")) else "",
            (student.get("name") or "").upper(),
            (student.get("registration_number") or "").upper(),
            (student.get("roll_number") or "").upper(),
            "",
            "",
        ]
        aligns = ["center", "left", "center", "center", "center", "center"]

        for col_index, value in enumerate(values):
            left = col_lefts[col_index]
            right = col_rights[col_index]
            if not value:
                continue
            if aligns[col_index] == "left":
                _draw_text(draw, (left + cell_padding, (row_top + row_bottom) / 2), value, regular_30, anchor="lm")
            else:
                _draw_text(draw, ((left + right) / 2, (row_top + row_bottom) / 2), value, regular_30, anchor="mm")

    primary_top = table_bottom + _mm(10)
    mini_box_size = _mm(7.5)
    _draw_text(draw, (content_left, primary_top), "No of Student Present", regular_34)
    draw.rectangle((content_left + _mm(43), primary_top - _mm(1), content_left + _mm(43) + mini_box_size, primary_top - _mm(1) + mini_box_size), outline="black", width=2)
    _draw_text(draw, (content_left, primary_top + _mm(11)), "No of Student Absent", regular_34)
    draw.rectangle((content_left + _mm(43), primary_top + _mm(10), content_left + _mm(43) + mini_box_size, primary_top + _mm(10) + mini_box_size), outline="black", width=2)

    internal_x = content_right - _mm(58)
    internal_sig_top = primary_top - _mm(2)
    draw.rectangle((internal_x, internal_sig_top, internal_x + _mm(36), internal_sig_top + _mm(14)), outline="black", width=2)
    _draw_text(draw, (internal_x + _mm(18), internal_sig_top + _mm(18)), "Signature of Examiner (Internal)", regular_30, anchor="ma")
    _draw_text(draw, (internal_x + _mm(18), internal_sig_top + _mm(24)), "Name (in CAPITAL):", regular_30, anchor="ma")

    secondary_y = A4_HEIGHT_PX - _mm(28)
    hod_left = content_left + _mm(10)
    hod_right = hod_left + _mm(48)
    draw.line((hod_left, secondary_y, hod_right, secondary_y), fill="black", width=2)
    _draw_text(draw, ((hod_left + hod_right) / 2, secondary_y + _mm(4)), "Signature of HoD", regular_34, anchor="ma")

    ext_left = content_right - _mm(58)
    ext_right = content_right - _mm(8)
    draw.line((ext_left, secondary_y, ext_right, secondary_y), fill="black", width=2)
    _draw_text(draw, ((ext_left + ext_right) / 2, secondary_y + _mm(4)), "Signature of Examiner (External)", regular_30, anchor="ma")
    _draw_text(draw, ((ext_left + ext_right) / 2, secondary_y + _mm(10)), "Name (in CAPITAL):", regular_30, anchor="ma")

    footer_label = page_meta.get("footer_label") or (
        f"{str(page_meta.get('branch', '')).upper()}_Sem {page_meta.get('semester', '')}".strip("_ ").strip()
    )
    footer_page = f"Page {page_meta.get('page_index', 1)} of {page_meta.get('total_pages', 1)}"
    _draw_text(draw, (content_left, A4_HEIGHT_PX - _mm(9)), footer_label, regular_30)
    _draw_text(draw, (content_right, A4_HEIGHT_PX - _mm(9)), footer_page, regular_30, anchor="ra")

    return image


def _build_attendance_pdf_response(sheets, exam_name):
    fonts = {
        "regular_30": _load_attendance_font(30),
        "regular_34": _load_attendance_font(34),
        "regular_36": _load_attendance_font(36),
        "regular_40": _load_attendance_font(40),
        "bold_34": _load_attendance_font(34, bold=True),
        "bold_38": _load_attendance_font(38, bold=True),
        "bold_42": _load_attendance_font(42, bold=True),
        "bold_46": _load_attendance_font(46, bold=True),
        "bold_48": _load_attendance_font(48, bold=True),
        "bold_54": _load_attendance_font(54, bold=True),
        "bold_64": _load_attendance_font(64, bold=True),
    }
    logo = _attendance_logo_image()
    pages = [_draw_attendance_sheet_page(page, exam_name, fonts, logo).convert("RGB") for page in (sheets or [{}])]

    pdf_buffer = BytesIO()
    first_page, rest_pages = pages[0], pages[1:]
    first_page.save(pdf_buffer, format="PDF", resolution=PDF_DPI, save_all=True, append_images=rest_pages)
    pdf_buffer.seek(0)

    filename = f"{_sanitize_download_filename(exam_name)}.pdf"
    response = HttpResponse(pdf_buffer.getvalue(), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _get_client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _read_student_dataframe(uploaded_file):
    """Parse a CSV/XLS/XLSX student upload into a dataframe."""
    print(f"[DEBUG] Reading file: {uploaded_file.name}")
    try:
        df = pd.read_csv(uploaded_file, dtype=str)
        print(f"[DEBUG] Parsed as CSV (default engine), shape: {df.shape}")
    except Exception as csv_err:
        print(f"[DEBUG] CSV parse error {csv_err}, trying python engine")
        try:
            uploaded_file.seek(0)
            df = pd.read_csv(uploaded_file, dtype=str, on_bad_lines='skip', engine='python')
            print(f"[DEBUG] Parsed as CSV (python engine), shape: {df.shape}")
        except Exception as csv_err2:
            print(f"[DEBUG] second CSV attempt failed {csv_err2}, falling back to Excel")
            try:
                uploaded_file.seek(0)
                xls = pd.ExcelFile(uploaded_file, engine='openpyxl')
                sheets = xls.sheet_names
                print(f"[DEBUG] Excel contains sheets: {sheets}")
                df_list = []
                for sn in sheets:
                    part = pd.read_excel(xls, sheet_name=sn, dtype=str)
                    print(f"[DEBUG] sheet {sn} shape {part.shape}")
                    df_list.append(part)
                df = pd.concat(df_list, ignore_index=True) if df_list else pd.DataFrame()
                print(f"[DEBUG] Combined Excel shape: {df.shape}")
            except Exception as excel_err:
                print(f"[DEBUG] multi-sheet Excel failed {excel_err}, single-sheet read")
                uploaded_file.seek(0)
                df = pd.read_excel(uploaded_file, dtype=str, engine='openpyxl')
                print(f"[DEBUG] Parsed as Excel single sheet, shape: {df.shape}")
    return df


def _extract_student_records_from_dataframe(df):
    df = df.dropna(how='all').reset_index(drop=True)
    if df.empty:
        raise ValueError("File is empty. Please check your file.")

    df.columns = df.columns.str.strip().str.lower()
    print(f"[DEBUG] Columns: {list(df.columns)}")
    print(f"[DEBUG] Total rows: {len(df)}")

    avail = set(df.columns)
    has_roll = any(c in avail for c in ['rollno', 'roll_no', 'roll number', 'roll no'])
    has_reg = any(c in avail for c in ['reg no', 'registration number', 'reg_no'])
    has_std_id = any(c in avail for c in ['std id', 'student id', 'student_id'])
    if not (has_roll and has_reg and has_std_id):
        raise ValueError("File missing required columns: ROLL NO, REG NO, STD ID")

    col_map = {
        "course": ["course"],
        "semester": ["sem", "semester"],
        "branch": ["branch"],
        "room_number": ["room number", "room_number", "room no", "roomno"],
        "name": ["student name", "name"],
        "roll_number": ["rollno", "roll_no", "roll number", "roll no"],
        "registration_number": ["reg no", "registration number", "reg_no"],
        "student_id": ["std id", "student id", "student_id"],
        "academic_status": ["academic_status", "academic status", "status"],
    }

    def get_value(row, keys, default=""):
        for key in keys:
            if key in row and pd.notna(row[key]):
                return str(row[key]).strip()
        return default

    records = df.to_dict(orient='records')
    students = []
    skipped = 0

    for row in records:
        roll = get_value(row, col_map["roll_number"])
        reg = get_value(row, col_map["registration_number"])
        std_id = get_value(row, col_map["student_id"])

        if not roll or not reg or not std_id:
            skipped += 1
            continue

        students.append({
            "roll_number": roll,
            "registration_number": reg,
            "student_id": std_id,
            "course": get_value(row, col_map["course"]),
            "semester": get_value(row, col_map["semester"]),
            "branch": get_value(row, col_map["branch"]),
            "room_number": get_value(row, col_map["room_number"]),
            "name": get_value(row, col_map["name"]),
            "academic_status": get_value(row, col_map["academic_status"]),
        })

    return {
        "records": students,
        "total": len(records),
        "inserted": len(students),
        "skipped": skipped,
    }


def _create_student_file_with_students(file_name, student_records):
    student_file_obj = StudentDataFile.objects.create(file_name=file_name)
    print(f"[DEBUG] StudentDataFile created id={student_file_obj.id}")

    objects_to_create = [
        Student(
            student_file=student_file_obj,
            roll_number=row["roll_number"],
            registration_number=row["registration_number"],
            student_id=row["student_id"],
            course=row.get("course", ""),
            semester=row.get("semester", ""),
            branch=row.get("branch", ""),
            room_number=row.get("room_number", ""),
            name=row.get("name", ""),
            academic_status=row.get("academic_status", ""),
        )
        for row in student_records
    ]

    with transaction.atomic():
        if objects_to_create:
            Student.objects.bulk_create(objects_to_create, batch_size=500)

    return student_file_obj


def _get_temp_attendance_uploads(request):
    return request.session.setdefault("attendance_wizard_uploads", {})


def _set_temp_attendance_upload(request, exam_id, payload):
    uploads = _get_temp_attendance_uploads(request)
    uploads[str(exam_id)] = payload
    request.session["attendance_wizard_uploads"] = uploads
    request.session.modified = True


def _pop_temp_attendance_upload(request, exam_id):
    uploads = _get_temp_attendance_uploads(request)
    payload = uploads.pop(str(exam_id), None)
    request.session["attendance_wizard_uploads"] = uploads
    request.session.modified = True
    return payload


def _get_temp_attendance_upload(request, exam_id):
    return _get_temp_attendance_uploads(request).get(str(exam_id))





def ensure_default_admin():
    try:
        if AdminAccount.objects.filter(username__iexact=ENV_ADMIN_USERNAME).count() == 0:
            username = ENV_ADMIN_USERNAME
            default_password = ENV_ADMIN_PASSWORD
            AdminAccount.objects.create(username=username, email=None, password_hash=make_password(default_password))
            logger.info(f'Default admin account created: {username}')
    except Exception as e:
        logger.error(f'Error in ensure_default_admin: {str(e)}')


def admin_required(view_func):
    def wrapper(request, *args, **kwargs):
        if not request.session.get('admin_logged_in'):
            return redirect('admin_login')
        return view_func(request, *args, **kwargs)
    return wrapper


def admin_required_json(view_func):
    def wrapper(request, *args, **kwargs):
        if not request.session.get('admin_logged_in'):
            return JsonResponse({'status': 'error', 'message': 'Admin login required'}, status=401)
        return view_func(request, *args, **kwargs)
    return wrapper


# =========================
# Admin Login
# =========================
def admin_login(request):
    """Support two login modes:
    - Hard-coded/env credentials (always valid) — method='hardcoded'
    - Database accounts (username may be an email) — method='db'
    """
    ensure_default_admin()
    error = None

    if request.method == "POST":
        username = (request.POST.get("username") or '').strip()
        password = request.POST.get("password") or ''

        # Hard-coded/env check
        default_username = ENV_ADMIN_USERNAME
        default_password = ENV_ADMIN_PASSWORD
        if username == default_username and password == default_password:
            # login success
            request.session['admin_logged_in'] = True
            request.session['admin_username'] = username
            # sync DB account for auditing
            try:
                admin, _ = AdminAccount.objects.get_or_create(username=username)
                admin.password_hash = make_password(password)
                admin.save()
            except Exception:
                pass
            return redirect('dashboard')

        # DB-based login
        try:
            # If someone logs in using an email as username, it must be eligible and not blocked
            blocked = BlockedAdminEmail.objects.filter(email__iexact=username).exists()
            if blocked:
                error = 'This account has been blocked'
            else:
                admin = AdminAccount.objects.get(username__iexact=username)
                if check_password(password, admin.password_hash):
                    request.session['admin_logged_in'] = True
                    request.session['admin_username'] = admin.username
                    return redirect('dashboard')
                else:
                    error = 'Invalid username or password'
        except AdminAccount.DoesNotExist:
            error = 'Invalid username or password'

    return render(request, 'core/admin_login.html', {'error': error})


@admin_required
def dashboard(request):
    uploaded_files = StudentDataFile.objects.all().order_by('-uploaded_at')
    years = range(2020, 2036)
    eligible_emails = EligibleAdminEmail.objects.all().order_by('-added_at')

    # Universal QR and student portal URLs (used in dashboard QR tab)
    from django.urls import reverse
    qr_url = request.build_absolute_uri(reverse('generate_qr')) + '?type=student_portal'
    student_portal_url = request.build_absolute_uri(reverse('student_portal'))

    return render(request, 'core/dashboard.html', {
        'uploaded_files': uploaded_files,
        'years': years,
        'eligible_emails': eligible_emails,
        'qr_url': qr_url,
        'student_portal_url': student_portal_url,
    })


def admin_logout(request):
    request.session.pop('admin_logged_in', None)
    request.session.pop('admin_username', None)
    return redirect('admin_login')


# =========================
# Forgot Password
# =========================
def generate_username(email):
    """Generate username from email (before @)"""
    return email.split('@')[0]


def generate_temp_password(length=12):
    """Generate a random temporary password"""
    characters = string.ascii_letters + string.digits + '!@#$%^&*'
    return ''.join(secrets.choice(characters) for _ in range(length))


def send_password_reset_email(email, username, reset_token, request):
    """Send password reset email with link - with timeout protection"""
    try:
        reset_link = request.build_absolute_uri(f'/reset-password-link/?token={reset_token}')
        subject = 'Password Reset Request - Exam Management System'
        message = f"""
Dear Administrator,

You have requested to reset your admin password. Your login credentials are as follows:

Username: {username}

To reset your password, please visit the following link (valid for 1 hour):

{reset_link}

If you did not request this password reset, please disregard this email or contact your system administrator immediately.

This is an automated message. Please do not reply to this email.

Regards,
Exam Management System Administration
        """
        
        # Try to send email with timeout protection
        import socket
        from smtplib import SMTPException
        
        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                [email],
                fail_silently=False,
            )
            logger.info(f"Password reset email sent successfully to {email}")
            return True
        except (socket.timeout, socket.error, SMTPException, OSError, Exception) as e:
            # Log the error but don't crash - return True for security
            logger.error(f"Email sending failed for {email}: {type(e).__name__} - {str(e)}")
            return True
            
    except Exception as e:
        logger.error(f"Error preparing password reset email for {email}: {str(e)}")
        return True


def forgot_password(request):
    form = ForgotPasswordForm(request.POST or None)
    message = None
    success = False
    username = None
    
    if request.method == 'POST' and form.is_valid():
        email = form.cleaned_data['email'].strip().lower()
        
        # Check if email is blocked
        if BlockedAdminEmail.objects.filter(email__iexact=email).exists():
            message = 'This email is blocked from password reset.'
        # Check if email is eligible
        elif not EligibleAdminEmail.objects.filter(email__iexact=email).exists():
            message = 'This email is not registered for admin password reset.'
        else:
            # Generate username from email
            username = generate_username(email)
            
            # Show success with username - user can now reset password
            message = f'Email verified successfully. Your username is: {username}'
            success = True

    return render(request, 'core/admin_forgot_password.html', {
        'form': form,
        'message': message,
        'success': success,
        'username': username
    })


# =========================
# Reset Password via Email Link
# =========================
def reset_password_link(request):
    """Handle password reset from email link"""
    token = request.GET.get('token', '')
    message = None
    success = False
    show_form = True
    
    if not token:
        message = 'Invalid reset link. Please request a new password reset.'
        show_form = False
    else:
        try:
            reset_record = PasswordResetToken.objects.get(token=token, used=False)
            
            # Check if token has expired
            if timezone.now() > reset_record.expires_at:
                message = 'This password reset link has expired. Please request a new one.'
                show_form = False
            elif request.method == 'POST':
                new_password = request.POST.get('new_password', '').strip()
                confirm_password = request.POST.get('confirm_password', '').strip()
                
                if not new_password:
                    message = 'Password cannot be empty.'
                elif new_password != confirm_password:
                    message = 'Passwords do not match.'
                elif len(new_password) < 8:
                    message = 'Password must be at least 8 characters long.'
                else:
                    # Create or update admin account
                    admin, _ = AdminAccount.objects.get_or_create(username=reset_record.username)
                    admin.email = reset_record.email
                    admin.password_hash = make_password(new_password)
                    admin.save()
                    
                    # Mark token as used
                    reset_record.used = True
                    reset_record.save()
                    
                    message = 'Password reset successfully! You can now login with your new password.'
                    success = True
                    show_form = False
                    
        except PasswordResetToken.DoesNotExist:
            message = 'Invalid reset link. Please request a new password reset.'
            show_form = False

    return render(request, 'core/admin_reset_password_link.html', {
        'message': message,
        'success': success,
        'show_form': show_form,
        'token': token
    })


# =========================
# Old Reset Password (kept for backward compatibility)
# =========================
def reset_password(request):
    form = ResetPasswordForm(request.POST or None, initial={'email': request.GET.get('email', '')})
    message = None
    if request.method == 'POST' and form.is_valid():
        email = form.cleaned_data['email'].strip().lower()
        new_password = form.cleaned_data['new_password']

        # Only allow reset if email is eligible and not blocked
        if BlockedAdminEmail.objects.filter(email__iexact=email).exists():
            message = 'This email is blocked'
        elif not EligibleAdminEmail.objects.filter(email__iexact=email).exists():
            message = 'This email is not eligible to reset password'
        else:
            # Generate username from email (same as forgot_password)
            username = generate_username(email)
            
            # Create or update admin account with generated username
            admin, _ = AdminAccount.objects.get_or_create(username=username)
            admin.email = email
            admin.password_hash = make_password(new_password)
            admin.save()
            message = 'Password reset successfully. Please login with your new password.'
            return render(request, 'core/admin_reset_password.html', {'form': form, 'message': message, 'success': True})

    return render(request, 'core/admin_reset_password.html', {'form': form, 'message': message})


# =========================
# Admin Emails Upload
# =========================
@admin_required
def upload_admin_emails(request):
    """Accept either a single email input (email) or multiple pasted emails (emails textarea).
    Always redirect back to the dashboard (admin-emails tab) so the UI stays on the same page."""
    from django.urls import reverse
    from .forms import AdminEmailForm

    form = AdminEmailForm(request.POST or None)

    if request.method == 'POST':
        added = 0
        errors = []
        # single email
        email = (request.POST.get('email') or '').strip().lower()
        if email:
            try:
                EligibleAdminEmail.objects.create(email=email)
                added += 1
            except Exception as e:
                errors.append(str(e))

        # multiple emails (pasted)
        emails_text = (request.POST.get('emails') or '').strip()
        if emails_text:
            for line in emails_text.splitlines():
                e = line.strip().lower()
                if not e:
                    continue
                if '@' not in e:
                    errors.append(f'invalid: {e}')
                    continue
                try:
                    EligibleAdminEmail.objects.create(email=e)
                    added += 1
                except Exception as ex:
                    errors.append(str(ex))

        from django.contrib import messages
        if added > 0:
            messages.success(request, f'Added {added} eligible admin email(s)')
        elif errors:
            messages.error(request, 'No emails added. ' + ('; '.join(errors)))
        else:
            messages.error(request, 'No email provided')

        # Redirect back to dashboard and open admin-emails tab
        return redirect(reverse('dashboard') + '?tab=admin-emails')

    # For GET, simply redirect to dashboard (no standalone page)
    return redirect(reverse('dashboard') + '?tab=admin-emails')


# =========================
# Delete Eligible Admin Email
# =========================
@admin_required
def delete_admin_email(request, email_id):
    if request.method == 'POST':
        try:
            e = EligibleAdminEmail.objects.get(id=email_id)
            e.delete()
            from django.urls import reverse
            from django.contrib import messages
            messages.success(request, f'Removed eligible email: {e.email}')
            return redirect(reverse('dashboard') + '?tab=admin-emails')
        except EligibleAdminEmail.DoesNotExist:
            return HttpResponse('Not found', status=404)
    return HttpResponse('Method not allowed', status=405)


# =========================
# Block an email
# =========================
@admin_required
def block_admin_email(request):
    if request.method == 'POST':
        email = request.POST.get('email')
        reason = request.POST.get('reason') or ''
        if email:
            try:
                BlockedAdminEmail.objects.get_or_create(email=email.lower(), defaults={'reason': reason})
                return redirect('dashboard')
            except Exception as e:
                return HttpResponse(f'Error: {e}', status=400)
    return HttpResponse('Method not allowed', status=405)


# =========================
# Upload Student Data (DB only, NO file storage)
# =========================
@admin_required
def upload_student_data(request):
    if request.method == "POST":
        from django.urls import reverse

        try:
            form = StudentDataUploadForm(request.POST, request.FILES)
            if not form.is_valid():
                messages.error(request, "Invalid form submission")
                return redirect(reverse('dashboard') + '?tab=upload-data')

            uploaded_file = request.FILES.get("file")
            if not uploaded_file:
                messages.error(request, "No file uploaded")
                return redirect(reverse('dashboard') + '?tab=upload-data')

            max_size = 10 * 1024 * 1024
            if uploaded_file.size > max_size:
                messages.error(request, "File size too large. Maximum allowed is 10MB.")
                return redirect(reverse('dashboard') + '?tab=upload-data')

            df = _read_student_dataframe(uploaded_file)
            parse_result = _extract_student_records_from_dataframe(df)
            total = parse_result["total"]
            inserted = parse_result["inserted"]
            skipped = parse_result["skipped"]

            _create_student_file_with_students(uploaded_file.name, parse_result["records"])

            print(f"[DEBUG] total rows {total}, inserted {inserted}, skipped {skipped}")

            # prepare user feedback
            if inserted == 0 and skipped:
                messages.warning(request, f"No students added. {skipped} skipped.")
            elif inserted == 0:
                messages.warning(request, "No students found in file. Please check your file format and data.")
            else:
                msg = f"Student data uploaded successfully! (total: {total}, inserted: {inserted})"
                if skipped:
                    msg += f" ({skipped} skipped)"
                messages.success(request, msg)

            return redirect(reverse('dashboard') + '?tab=upload-data')

        except IntegrityError as ie:
            logger.error(f"upload_student_data integrity error: {ie}")
            messages.error(request, "Database integrity error during upload. Please ensure the file has no duplicate rows.")
            return redirect(reverse('dashboard') + '?tab=upload-data')
        except Exception as exc:
            logger.error(f"upload_student_data unexpected: {exc}\n{traceback.format_exc()}")
            print("[ERROR] upload_student_data unexpected:\n", traceback.format_exc())
            messages.error(request,"Internal server error during upload. Please try again.")
            return redirect(reverse('dashboard') + '?tab=upload-data')
    # Handle GET request - show dashboard with uploaded files
    uploaded_files = StudentDataFile.objects.all().order_by("-uploaded_at")
    years = range(2020, 2036)
    eligible_emails = EligibleAdminEmail.objects.all().order_by('-added_at')
    from django.urls import reverse
    qr_url = request.build_absolute_uri(reverse('generate_qr')) + '?type=student_portal'
    student_portal_url = request.build_absolute_uri(reverse('student_portal'))

    return render(request, "core/dashboard.html", {
        'uploaded_files': uploaded_files,
        'years': years,
        'eligible_emails': eligible_emails,
        'qr_url': qr_url,
        'student_portal_url': student_portal_url,
    })


@csrf_exempt
@admin_required_json
def upload_attendance_wizard_file(request):
    if request.method != "POST":
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)

    try:
        exam_id = request.POST.get("exam_id")
        if not exam_id:
            return JsonResponse({"status": "error", "message": "exam_id is required"}, status=400)

        exam = Exam.objects.get(id=exam_id, is_temporary=True, is_completed=False)
        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            return JsonResponse({"status": "error", "message": "No file uploaded"}, status=400)

        max_size = 10 * 1024 * 1024
        if uploaded_file.size > max_size:
            return JsonResponse({"status": "error", "message": "File size too large. Maximum allowed is 10MB."}, status=400)

        df = _read_student_dataframe(uploaded_file)
        parse_result = _extract_student_records_from_dataframe(df)

        _set_temp_attendance_upload(request, exam.id, {
            "file_name": uploaded_file.name,
            "students": parse_result["records"],
            "total": parse_result["total"],
            "inserted": parse_result["inserted"],
            "skipped": parse_result["skipped"],
            "uploaded_at": timezone.now().strftime('%Y-%m-%d %H:%M'),
        })

        return JsonResponse({
            "status": "success",
            "file": {
                "file_name": uploaded_file.name,
                "student_count": parse_result["inserted"],
                "uploaded_at": timezone.now().strftime('%Y-%m-%d %H:%M'),
                "total": parse_result["total"],
                "skipped": parse_result["skipped"],
            }
        })
    except Exam.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Temporary exam not found"}, status=404)
    except ValueError as exc:
        return JsonResponse({"status": "error", "message": str(exc)}, status=400)
    except Exception as exc:
        logger.error(f"upload_attendance_wizard_file unexpected: {exc}\n{traceback.format_exc()}")
        return JsonResponse({"status": "error", "message": "Internal server error during upload. Please try again."}, status=500)


# =========================
# Delete Student File (DB only)
# =========================
@admin_required
def delete_student_file(request, file_id):
    student_file = get_object_or_404(StudentDataFile, id=file_id)
    student_file.delete()  # cascades to Student table
    messages.success(request, "File and related student data deleted successfully!")
    return redirect("dashboard")


@admin_required_json
def get_file_students(request):
    """Fetch all students from a file. Query: file_id=int"""
    try:
        file_id = request.GET.get('file_id')
        if not file_id:
            return JsonResponse({'status': 'error', 'message': 'file_id required'}, status=400)
        file_obj = StudentDataFile.objects.get(id=file_id)
        students = list(Student.objects.filter(student_file=file_obj).values(
            'id', 'name', 'roll_number', 'registration_number', 'student_id', 'course', 'semester', 'branch', 'room_number', 'academic_status'
        ))
        return JsonResponse({
            'status': 'success',
            'file': {
                'id': file_obj.id,
                'file_name': file_obj.file_name,
                'uploaded_at': file_obj.uploaded_at.strftime('%Y-%m-%d %H:%M') if file_obj.uploaded_at else 'Unknown'
            },
            'students': students,
            'total_students': len(students)
        })
    except StudentDataFile.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'File not found'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@admin_required_json
def update_students(request):
    """Update multiple students. POST JSON: { students: [ {id, name, roll_number, registration_number, student_id, course, semester, branch, room_number, academic_status}, ... ] }"""
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=400)
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
        students = payload.get('students') or []
        updated = 0
        for s in students:
            sid = s.get('id')
            if not sid:
                continue
            try:
                st = Student.objects.get(id=sid)
                for field in ['name', 'roll_number', 'registration_number', 'student_id', 'course', 'semester', 'branch', 'room_number', 'academic_status']:
                    if field in s:
                        setattr(st, field, s.get(field))
                st.save()
                updated += 1
            except Student.DoesNotExist:
                continue

        return JsonResponse({'status': 'success', 'updated': updated})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


@admin_required_json
def add_file_students(request):
    """Add new students to a StudentDataFile. POST JSON: { file_id: int, students: [ {name, roll_number, registration_number, student_id, course, semester, branch, room_number, academic_status}, ... ] }"""
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=400)
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
        file_id = payload.get('file_id')
        students = payload.get('students') or []
        if not file_id:
            return JsonResponse({'status': 'error', 'message': 'file_id required'}, status=400)
        file_obj = StudentDataFile.objects.get(id=file_id)
        to_create = []
        for s in students:
            name = s.get('name') or ''
            roll = s.get('roll_number') or ''
            reg = s.get('registration_number') or ''
            std_id = s.get('student_id') or ''
            course = s.get('course') or ''
            semester = s.get('semester') or ''
            branch = s.get('branch') or ''
            room_number = s.get('room_number') or ''
            academic_status = s.get('academic_status') or ''
            
            to_create.append(Student(
                student_file=file_obj,
                name=name,
                roll_number=roll,
                registration_number=reg,
                student_id=std_id,
                course=course,
                semester=semester,
                branch=branch,
                room_number=room_number,
                academic_status=academic_status
            ))

        Student.objects.bulk_create(to_create)
        return JsonResponse({'status': 'success', 'added': len(to_create)})
    except StudentDataFile.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'File not found'}, status=404)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)



# =========================
# Exam Setup Page
# =========================
@admin_required
def exam_setup(request):
    return render(request, "core/exam_setup.html")


# =========================
# Attendance Wizard Page
# =========================
@admin_required
def attendance_wizard(request):
    """Two-step wizard for generating attendance sheets."""
    return render(request, "core/attendance_wizard.html")


# =========================
# Initialize Temporary Exam (When exam_setup loads)
# =========================
@admin_required_json
def init_temp_exam(request):
    """
    Creates a temporary exam when exam_setup page loads.
    This exam will be deleted if user refreshes before completing setup.
    """
    if request.method == "GET":
        try:
            # Create a temporary exam with no name or dates (just placeholders)
            temp_exam = Exam.objects.create(
                name="temp_exam",
                is_temporary=True,
                is_completed=False
            )
            
            logger.info(f"Temporary exam created: ID={temp_exam.id}")
            
            return JsonResponse({
                "status": "success",
                "exam_id": temp_exam.id
            })
        except Exception as e:
            logger.error(f"Error creating temporary exam: {str(e)}")
            return JsonResponse({
                "status": "error",
                "message": str(e)
            }, status=400)
    
    logger.warning(f"Invalid method in init_temp_exam: {request.method}")
    return JsonResponse({"status": "error", "message": "GET method required"}, status=400)


# =========================
# Mark Exam as Complete
# =========================
@admin_required_json
def complete_exam_setup(request):
    """
    Called when Complete Setup button is clicked at the very end (after lock_seating).
    Marks the exam as completed (permanently saves, no deletion on refresh).
    This ensures all data (exam, departments, rooms, students, seating) is only
    permanently saved when user explicitly clicks Complete Setup at the end.
    """
    if request.method == "POST":
        try:
            from django.conf import settings
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            
            logger.info(f'Received complete setup request for exam_id: {exam_id}')
            
            exam = Exam.objects.get(id=exam_id)
            logger.info(f'Found exam: {exam.name} (ID: {exam.id})')
            logger.debug(f'Before: is_temporary={exam.is_temporary}, is_completed={exam.is_completed}')
            
            # Mark exam as permanently completed
            exam.is_temporary = False
            exam.is_completed = True
            exam.save()
            
            logger.info(f'Exam {exam.id} marked as PERMANENT in database')
            
            # Get dashboard URL from settings (ensure user returns to generate-sheet tab)
            dashboard_url = settings.ADMIN_DASHBOARD_URL
            if '?' in dashboard_url:
                dashboard_url += '&tab=generate-sheet'
            else:
                dashboard_url += '?tab=generate-sheet'
            
            return JsonResponse({
                "status": "success",
                "message": "Exam setup completed. All data permanently saved to database.",
                "dashboard_url": dashboard_url
            })
        except Exam.DoesNotExist:
            logger.warning(f'Complete setup: Exam not found with ID: {exam_id}')
            return JsonResponse({
                "status": "error",
                "message": f"Exam not found with ID: {exam_id}"
            }, status=400)
        except Exception as e:
            logger.error(f'Error in complete_exam_setup: {str(e)}')
            return JsonResponse({
                "status": "error",
                "message": str(e)
            }, status=400)
    
    return JsonResponse({"status": "error"}, status=400)


@admin_required_json
def add_room_single(request):
    """Add a single room to an existing exam without deleting other rooms.

    Payload: { exam_id, building, room_number, capacity }
    """
    if request.method != 'POST':
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)
    try:
        data = json.loads(request.body)
        exam_id = data.get('exam_id')
        building = (data.get('building') or '').strip()
        room_number = (data.get('room_number') or '').strip()
        capacity = int(data.get('capacity') or 0)

        if not exam_id or not building or not room_number or capacity <= 0:
            return JsonResponse({"status": "error", "message": "exam_id, building, room_number and positive capacity are required"}, status=400)

        exam = Exam.objects.get(id=exam_id)

        # Prevent duplicate building+room_number for same exam
        if Room.objects.filter(exam=exam, building__iexact=building, room_number__iexact=room_number).exists():
            return JsonResponse({"status": "error", "message": "Room with same building and room number already exists for this exam"}, status=400)

        room = Room.objects.create(exam=exam, building=building, room_number=room_number, capacity=capacity)
        return JsonResponse({"status": "success", "room": {"id": room.id, "building": room.building, "room_number": room.room_number, "capacity": room.capacity}})
    except Exam.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# Update Temporary Exam (name)
# =========================
@csrf_exempt
@admin_required_json
def update_temp_exam(request):
    """Allows the wizard to update the name of a temporary exam (step1)."""
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            name = (data.get("name") or "").strip()
            exam = Exam.objects.get(id=exam_id, is_temporary=True, is_completed=False)
            exam.name = name
            exam.save()
            return JsonResponse({"status": "success"})
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Temporary exam not found"}, status=404)
        except Exception as e:
            logger.error(f"update_temp_exam error: {str(e)}")
            return JsonResponse({"status": "error", "message": str(e)}, status=400)
    return JsonResponse({"status": "error", "message": "POST required"}, status=400)


# =========================
# Generate Attendance Sheets
# =========================
@csrf_exempt
@admin_required_json
def generate_sheets(request):
    """Given an exam_id and file_id, return paginated sheet data (20 students per sheet).

    Preserves original file order (DB insertion order), filters by eligible academic_status,
    groups students by room number when available (falling back to branch/semester),
    and paginates each group into pages of 20.
    """
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            file_id = data.get("file_id")
            exam = Exam.objects.get(id=exam_id)
            student_file = None

            if file_id:
                student_file = StudentDataFile.objects.get(id=file_id)
                qs = Student.objects.filter(student_file=student_file).values(
                    'id', 'name', 'roll_number', 'registration_number', 'semester', 'branch', 'room_number', 'academic_status'
                ).order_by('id')
                students = list(qs)
            else:
                temp_upload = _get_temp_attendance_upload(request, exam_id)
                if not temp_upload:
                    return JsonResponse({"status": "error", "message": "No temporary student file uploaded"}, status=400)
                students = [
                    {
                        'id': index + 1,
                        'name': row.get('name', ''),
                        'roll_number': row.get('roll_number', ''),
                        'registration_number': row.get('registration_number', ''),
                        'semester': row.get('semester', ''),
                        'branch': row.get('branch', ''),
                        'room_number': row.get('room_number', ''),
                        'academic_status': row.get('academic_status', ''),
                    }
                    for index, row in enumerate(temp_upload.get("students", []))
                ]

            from collections import OrderedDict
            groups = OrderedDict()

            def is_eligible(status):
                s = (status or '').strip().lower()
                # Accept explicit 'eligible' values or statuses starting with 'reg' (e.g. 'regular')
                return (s.startswith('reg') or 'elig' in s)

            for s in students:
                if not is_eligible(s.get('academic_status')):
                    continue
                room_number = str(s.get('room_number') or '').strip()
                branch = (s.get('branch') or '').strip()
                semester = str(s.get('semester') or '')
                key = ('room', room_number) if room_number else ('branch_sem', branch, semester)
                groups.setdefault(key, []).append(s)

            pages = []
            for key, group_students in groups.items():
                room_number = ''
                branch = ''
                semester = ''

                if key[0] == 'room':
                    room_number = key[1]
                else:
                    branch = key[1]
                    semester = key[2]

                total_pages = (len(group_students) + ATTENDANCE_SHEET_STUDENTS_PER_PAGE - 1) // ATTENDANCE_SHEET_STUDENTS_PER_PAGE
                for p in range(total_pages):
                    start = p * ATTENDANCE_SHEET_STUDENTS_PER_PAGE
                    end = (p + 1) * ATTENDANCE_SHEET_STUDENTS_PER_PAGE
                    chunk = group_students[start:end]

                    chunk_labels = []
                    seen_labels = set()
                    for student in chunk:
                        chunk_branch = str(student.get('branch') or '').strip()
                        chunk_semester = str(student.get('semester') or '').strip()
                        if chunk_branch and chunk_semester:
                            label = f"{chunk_branch.upper()}_Sem {chunk_semester}"
                        elif chunk_branch:
                            label = chunk_branch.upper()
                        elif chunk_semester:
                            label = f"Sem {chunk_semester}"
                        else:
                            label = ''
                        if label and label not in seen_labels:
                            seen_labels.add(label)
                            chunk_labels.append(label)

                    pages.append({
                        'students': chunk,
                        'room_number': room_number,
                        'branch': branch,
                        'semester': semester,
                        'footer_label': ', '.join(chunk_labels),
                        'page_index': p + 1,
                        'total_pages': total_pages,
                    })

            return JsonResponse({
                "status": "success",
                "sheets": pages,
                "exam_name": exam.name or ''
            })
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
        except StudentDataFile.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Student file not found"}, status=404)
        except Exception as e:
            logger.error(f"generate_sheets error: {str(e)}")
            return JsonResponse({"status": "error", "message": str(e)}, status=400)
    return JsonResponse({"status": "error", "message": "POST required"}, status=400)


# =========================
# Save Generated Sheets
# =========================
@csrf_exempt
@admin_required_json
def save_generated_sheets(request):
    """Store generated sheet data so it can be shown on dashboard later."""
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            file_id = data.get("file_id")
            sheets = data.get("sheets")
            exam = Exam.objects.get(id=exam_id)
            student_file = None

            if file_id:
                student_file = StudentDataFile.objects.get(id=file_id)
            else:
                temp_upload = _pop_temp_attendance_upload(request, exam_id)
                if not temp_upload:
                    return JsonResponse({"status": "error", "message": "No temporary student file available to save"}, status=400)
                student_file = _create_student_file_with_students(
                    temp_upload.get("file_name") or "attendance_wizard_upload.xlsx",
                    temp_upload.get("students", []),
                )
            # record in AttendanceSheet model
            AttendanceSheet.objects.create(
                exam=exam,
                student_file=student_file,
                sheet_data=sheets
            )
            return JsonResponse({"status": "success"})
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
        except StudentDataFile.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Student file not found"}, status=404)
        except Exception as e:
            logger.error(f"save_generated_sheets error: {str(e)}")
            return JsonResponse({"status": "error", "message": str(e)}, status=400)
    return JsonResponse({"status": "error", "message": "POST required"}, status=400)


# =========================
# List Generated Sheets (Dashboard)
# =========================
@csrf_exempt
@admin_required_json
def get_generated_sheets(request):
    if request.method == "GET":
        try:
            rows = []
            for sheet in AttendanceSheet.objects.select_related('exam', 'student_file').order_by('-generated_at'):
                count = 0
                if sheet.sheet_data:
                    # calculate actual student count
                    count = sum(len(page) for page in sheet.sheet_data)
                rows.append({
                    'id': sheet.id,
                    'exam_name': sheet.exam.name,
                    'file_name': sheet.student_file.file_name,
                    'generated_at': sheet.generated_at.strftime('%Y-%m-%d %H:%M:%S'),
                    'student_count': count,
                    'sheet_count': len(sheet.sheet_data) if sheet.sheet_data else 0,
                })
            return JsonResponse({'status': 'success', 'sheets': rows})
        except Exception as e:
            logger.error(f"get_generated_sheets error: {str(e)}")
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    return JsonResponse({'status': 'error', 'message': 'GET required'}, status=400)


# API: single sheet details
@csrf_exempt
@admin_required_json
def get_generated_sheet(request):
    if request.method == 'GET':
        try:
            sheet_id = request.GET.get('id')
            if not sheet_id:
                return JsonResponse({'status':'error','message':'id parameter required'}, status=400)
            sheet = AttendanceSheet.objects.select_related('exam','student_file').get(id=sheet_id)
            return JsonResponse({
                'status':'success',
                'sheet':{
                    'id': sheet.id,
                    'exam_name': sheet.exam.name,
                    'file_name': sheet.student_file.file_name,
                    'generated_at': sheet.generated_at.strftime('%Y-%m-%d %H:%M:%S'),
                    'sheets': sheet.sheet_data or []
                }
            })
        except AttendanceSheet.DoesNotExist:
            return JsonResponse({'status':'error','message':'Saved sheet not found'}, status=404)
        except Exception as e:
            logger.error(f"get_generated_sheet error: {str(e)}")
            return JsonResponse({'status':'error','message':str(e)}, status=400)
    return JsonResponse({'status':'error','message':'GET required'}, status=400)


# API: delete saved sheet record
@csrf_exempt
@admin_required_json
def delete_generated_sheet(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            sheet_id = data.get('id')
            if not sheet_id:
                return JsonResponse({'status':'error','message':'id required'}, status=400)
            sheet = AttendanceSheet.objects.get(id=sheet_id)
            sheet.delete()
            return JsonResponse({'status':'success'})
        except AttendanceSheet.DoesNotExist:
            return JsonResponse({'status':'error','message':'Saved sheet not found'}, status=404)
        except Exception as e:
            logger.error(f"delete_generated_sheet error: {str(e)}")
            return JsonResponse({'status':'error','message':str(e)}, status=400)
    return JsonResponse({'status':'error','message':'POST required'}, status=400)


# =========================
# Delete Temporary Exam (On page unload/refresh)


# =========================
# HTML page for viewing generated sheets
# =========================
@admin_required
def view_generated_sheet(request):
    sheet_id = request.GET.get('id')
    if not sheet_id:
        return HttpResponse("Missing id", status=400)
    try:
        sheet = AttendanceSheet.objects.select_related('exam', 'student_file').get(id=sheet_id)
    except AttendanceSheet.DoesNotExist:
        return HttpResponse("Sheet not found", status=404)
    context = {
        'exam_name': sheet.exam.name,
        'sheets': sheet.sheet_data or []
    }
    return render(request, 'core/generated_sheet_view.html', context)


@csrf_exempt
@admin_required
def download_attendance_sheet_pdf(request):
    try:
        if request.method == "GET":
            sheet_id = request.GET.get("id")
            if not sheet_id:
                return HttpResponse("Missing id", status=400)
            sheet = AttendanceSheet.objects.select_related("exam").get(id=sheet_id)
            return _build_attendance_pdf_response(sheet.sheet_data or [], sheet.exam.name or "attendance-sheet")

        if request.method == "POST":
            data = json.loads(request.body or "{}")
            exam_name = data.get("exam_name") or "attendance-sheet"
            sheets = data.get("sheets") or []
            return _build_attendance_pdf_response(sheets, exam_name)

        return HttpResponse("Method not allowed", status=405)
    except AttendanceSheet.DoesNotExist:
        return HttpResponse("Sheet not found", status=404)
    except Exception as exc:
        logger.error(f"download_attendance_sheet_pdf error: {exc}\n{traceback.format_exc()}")
        return HttpResponse("Unable to generate PDF", status=500)


# =========================
# Marks Sheet Wizard Page
# =========================
@admin_required
def marksheet_wizard(request):
    """Two-step wizard for generating marks sheets."""
    return render(request, "core/marksheet_wizard.html")


# =========================
# Generate Marks Sheets
# =========================
@csrf_exempt
@admin_required_json
def generate_marks_sheets(request):
    """Given an exam_id and file_id, return paginated marks sheet data (15 students per sheet).

    Preserves original file order (DB insertion order), filters by eligible academic_status,
    groups students by (branch, semester) preserving encounter order, and paginates each group
    into pages of 15. Each page returned as a dict with metadata so the frontend can render
    branch/semester and page numbering.
    """
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            file_id = data.get("file_id")
            exam = Exam.objects.get(id=exam_id)
            student_file = StudentDataFile.objects.get(id=file_id)

            # fetch students in DB insertion order (by PK)
            qs = Student.objects.filter(student_file=student_file).values(
                'id', 'name', 'roll_number', 'registration_number', 'semester', 'branch', 'academic_status'
            ).order_by('id')

            students = list(qs)

            # Group by (branch, semester) while preserving encounter order
            from collections import OrderedDict
            groups = OrderedDict()

            def is_eligible(status):
                s = (status or '').strip().lower()
                # Accept explicit 'eligible' values or statuses starting with 'reg' (e.g. 'regular')
                return (s.startswith('reg') or 'elig' in s)

            for s in students:
                if not is_eligible(s.get('academic_status')):
                    continue
                branch = (s.get('branch') or '').strip()
                semester = str(s.get('semester') or '')
                key = (branch, semester)
                groups.setdefault(key, []).append(s)

            pages = []
            for (branch, semester), group_students in groups.items():
                total_pages = (len(group_students) + 14) // 15
                for p in range(total_pages):
                    chunk = group_students[p*15:(p+1)*15]
                    pages.append({
                        'students': chunk,
                        'branch': branch,
                        'semester': semester,
                        'page_index': p + 1,
                        'total_pages': total_pages,
                    })

            # pagination is handled per branch/semester; frontend will use page_index/total_pages

            return JsonResponse({
                "status": "success",
                "sheets": pages,
                "exam_name": exam.name or ''
            })
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
        except StudentDataFile.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Student file not found"}, status=404)
        except Exception as e:
            logger.error(f"generate_marks_sheets error: {str(e)}")
            return JsonResponse({"status": "error", "message": str(e)}, status=400)
    return JsonResponse({"status": "error", "message": "POST required"}, status=400)


# =========================
# Save Generated Marks Sheets
# =========================
@csrf_exempt
@admin_required_json
def save_generated_marks_sheets(request):
    """Store generated marks sheet data so it can be shown on dashboard later."""
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            file_id = data.get("file_id")
            sheets = data.get("sheets")
            exam = Exam.objects.get(id=exam_id)
            student_file = StudentDataFile.objects.get(id=file_id)
            # record in MarksSheet model
            MarksSheet.objects.create(
                exam=exam,
                student_file=student_file,
                sheet_data=sheets
            )
            return JsonResponse({"status": "success"})
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
        except StudentDataFile.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Student file not found"}, status=404)
        except Exception as e:
            logger.error(f"save_generated_marks_sheets error: {str(e)}")
            return JsonResponse({"status": "error", "message": str(e)}, status=400)
    return JsonResponse({"status": "error", "message": "POST required"}, status=400)


# =========================
# List Generated Marks Sheets (Dashboard)
# =========================
@csrf_exempt
@admin_required_json
def get_generated_marks_sheets(request):
    if request.method == "GET":
        try:
            rows = []
            for sheet in MarksSheet.objects.select_related('exam', 'student_file').order_by('-generated_at'):
                count = 0
                if sheet.sheet_data:
                    # calculate actual student count
                    count = sum(len(page) for page in sheet.sheet_data)
                rows.append({
                    'id': sheet.id,
                    'exam_name': sheet.exam.name,
                    'file_name': sheet.student_file.file_name,
                    'generated_at': sheet.generated_at.strftime('%Y-%m-%d %H:%M:%S'),
                    'student_count': count,
                    'sheet_count': len(sheet.sheet_data) if sheet.sheet_data else 0,
                })
            return JsonResponse({'status': 'success', 'sheets': rows})
        except Exception as e:
            logger.error(f"get_generated_marks_sheets error: {str(e)}")
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
    return JsonResponse({'status': 'error', 'message': 'GET required'}, status=400)


# API: single marks sheet details
@csrf_exempt
@admin_required_json
def get_generated_marks_sheet(request):
    if request.method == 'GET':
        try:
            sheet_id = request.GET.get('id')
            if not sheet_id:
                return JsonResponse({'status':'error','message':'id parameter required'}, status=400)
            sheet = MarksSheet.objects.select_related('exam','student_file').get(id=sheet_id)
            return JsonResponse({
                'status':'success',
                'sheet':{
                    'id': sheet.id,
                    'exam_name': sheet.exam.name,
                    'file_name': sheet.student_file.file_name,
                    'generated_at': sheet.generated_at.strftime('%Y-%m-%d %H:%M:%S'),
                    'sheets': sheet.sheet_data or []
                }
            })
        except MarksSheet.DoesNotExist:
            return JsonResponse({'status':'error','message':'Saved sheet not found'}, status=404)
        except Exception as e:
            logger.error(f"get_generated_marks_sheet error: {str(e)}")
            return JsonResponse({'status':'error','message':str(e)}, status=400)
    return JsonResponse({'status':'error','message':'GET required'}, status=400)


# API: delete saved marks sheet record
@csrf_exempt
@admin_required_json
def delete_generated_marks_sheet(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            sheet_id = data.get('id')
            if not sheet_id:
                return JsonResponse({'status':'error','message':'id required'}, status=400)
            sheet = MarksSheet.objects.get(id=sheet_id)
            sheet.delete()
            return JsonResponse({'status':'success'})
        except MarksSheet.DoesNotExist:
            return JsonResponse({'status':'error','message':'Saved sheet not found'}, status=404)
        except Exception as e:
            logger.error(f"delete_generated_marks_sheet error: {str(e)}")
            return JsonResponse({'status':'error','message':str(e)}, status=400)
    return JsonResponse({'status':'error','message':'POST required'}, status=400)


# =========================
# HTML page for viewing generated marks sheets
# =========================
@admin_required
def view_generated_marks_sheet(request):
    sheet_id = request.GET.get('id')
    if not sheet_id:
        return HttpResponse("Missing id", status=400)
    try:
        sheet = MarksSheet.objects.select_related('exam', 'student_file').get(id=sheet_id)
    except MarksSheet.DoesNotExist:
        return HttpResponse("Sheet not found", status=404)
    context = {
        'exam_name': sheet.exam.name,
        'sheets': sheet.sheet_data or []
    }
    return render(request, 'core/generated_marks_sheet_view.html', context)


# =========================
# Delete Temporary Exam (On page unload/refresh)
# =========================
@csrf_exempt
@admin_required_json
def delete_temp_exam(request):
    """
    Called when page unloads/refreshes before completion.
    Deletes the temporary exam and all its associated data.
    """
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            _pop_temp_attendance_upload(request, exam_id)
            
            exam = Exam.objects.get(id=exam_id)
            
            # Only delete if it's still temporary (not completed)
            if exam.is_temporary and not exam.is_completed:
                exam.delete()
                return JsonResponse({
                    "status": "success",
                    "message": "Temporary exam deleted"
                })
            else:
                return JsonResponse({
                    "status": "success",
                    "message": "Exam is completed, not deleted"
                })
        except Exam.DoesNotExist:
            return JsonResponse({
                "status": "success",
                "message": "Exam not found"
            })
        except Exception as e:
            return JsonResponse({
                "status": "error",
                "message": str(e)
            }, status=400)
    
    return JsonResponse({"status": "error"}, status=400)


# =========================
# Create Exam (API)
# =========================
@admin_required_json
def create_exam(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            
            if not exam_id:
                return JsonResponse({
                    "status": "error",
                    "message": "exam_id is required"
                }, status=400)

            exam = Exam.objects.get(id=exam_id)
            exam.name = data.get("name")
            exam.start_date = data.get("start_date")
            exam.end_date = data.get("end_date")
            exam.save()

            return JsonResponse({
                "status": "success",
                "exam_id": exam.id
            })

        except Exam.DoesNotExist:
            return JsonResponse({
                "status": "error",
                "message": f"Exam with ID {exam_id} not found. Please refresh the page."
            }, status=400)
        except json.JSONDecodeError:
            return JsonResponse({
                "status": "error",
                "message": "Invalid JSON in request"
            }, status=400)


# =========================
# Delete Exam (Admin)
# =========================
@admin_required_json
def delete_exam(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            exam_id = data.get('exam_id')
            if not exam_id:
                return JsonResponse({'status': 'error', 'message': 'exam_id is required'}, status=400)

            try:
                exam = Exam.objects.get(id=exam_id)
            except Exam.DoesNotExist:
                return JsonResponse({'status': 'error', 'message': 'Exam not found'}, status=404)

            # Delete the exam (cascade will remove related objects)
            exam.delete()
            logger.info(f"Deleted exam {exam_id} and related data by admin")
            return JsonResponse({'status': 'success', 'message': 'Exam deleted'})
        except json.JSONDecodeError:
            return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)}, status=400)

    return JsonResponse({'status': 'error'}, status=400)


# =========================
# Add Departments & Papers (API)
# =========================
@admin_required_json
def add_departments(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get("exam_id")
            departments = data.get("departments", [])

            exam = Exam.objects.get(id=exam_id)
            print(f"\n[DEBUG add_departments] Creating departments for exam {exam_id}")
            print(f"[DEBUG] Departments received: {[d.get('department') for d in departments]}")
            
            if not departments:
                raise ValueError("No departments provided!")
            
            total_exams_created = 0

            for dept in departments:
                department_name = dept.get("department")
                exams_list = dept.get("exams", [])
                
                print(f"[DEBUG] Processing department: '{department_name}'")
                print(f"[DEBUG]   Total exams for this dept: {len(exams_list)}")
                
                if not exams_list:
                    print(f"[DEBUG]   ⚠ WARNING: No exams for department '{department_name}'")
                    continue

                for idx, ex in enumerate(exams_list):
                    try:
                        de = DepartmentExam.objects.create(
                            exam=exam,
                            department=department_name,
                            exam_name=ex.get("name"),
                            paper_code=ex.get("code"),
                            exam_date=ex.get("date"),
                            session=ex.get("session"),
                            start_time=ex.get("start_time") or None,
                            end_time=ex.get("end_time") or None,
                            semester=ex.get("semester") or None
                        )
                        print(f"[DEBUG]   ✓ Exam {idx+1}: dept='{de.department}', date={de.exam_date}, session={de.session}, time={de.start_time}-{de.end_time}, semester={de.semester}")
                        total_exams_created += 1
                    except Exception as exam_err:
                        print(f"[DEBUG]   ✗ ERROR creating exam {idx+1}: {str(exam_err)}")
                        raise

            # Log all created DepartmentExam records
            all_depts = DepartmentExam.objects.filter(exam=exam).values_list('department', flat=True).distinct()
            print(f"[DEBUG] ===== RESULT =====")
            print(f"[DEBUG] Department exams created: {total_exams_created}")
            print(f"[DEBUG] Unique departments: {list(all_depts)}")
            print(f"[DEBUG] ====================\n")
            
            return JsonResponse({"status": "success", "message": f"Created {total_exams_created} department exam entries"})

        except Exception as e:
            error_msg = f"Error in add_departments: {str(e)}"
            print(f"[DEBUG] ✗ {error_msg}")
            import traceback
            traceback.print_exc()
            return JsonResponse({
                "status": "error",
                "message": error_msg
            }, status=400)

    return JsonResponse({"status": "error", "message": "POST request required"}, status=400)

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
from .models import Exam, Room

@admin_required_json
def add_rooms(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get('exam_id')
            rooms = data.get('rooms', [])

            exam = Exam.objects.get(id=exam_id)

            # Validate rooms before saving
            seen_rooms = set()
            for r in rooms:
                building = r['building']
                room_number = r['room_number']
                
                # Check if same building + room number combination exists
                room_key = (building, room_number)
                if room_key in seen_rooms:
                    return JsonResponse({
                        "status": "error",
                        "message": f"Duplicate room detected: '{room_number}' in '{building}' appears multiple times. Each room must have a unique building + room number combination."
                    }, status=400)
                seen_rooms.add(room_key)
                
                # Check if building and room number are the same (user-friendly check)
                if building == room_number:
                    return JsonResponse({
                        "status": "error",
                        "message": f"Invalid room: Building name '{building}' and Room number '{room_number}' cannot be the same. Please use different values (e.g., Building='Main Building', Room='303')."
                    }, status=400)

            # Delete old rooms for exam (optional)
            Room.objects.filter(exam=exam).delete()

            for r in rooms:
                Room.objects.create(
                    exam=exam,
                    building=r['building'],
                    room_number=r['room_number'],
                    capacity=r['capacity']
                )

            return JsonResponse({"status": "success"})
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=400)
        except Exception as e:
            return JsonResponse({"status": "error", "message": str(e)}, status=400)


@admin_required_json
def upload_rooms_file(request):
    """Upload a CSV/XLS file containing room definitions (Building, Room Number, Capacity)."""
    if request.method != 'POST':
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)

    try:
        exam_id = request.POST.get('exam_id') or request.GET.get('exam_id')
        if not exam_id:
            return JsonResponse({"status": "error", "message": "exam_id is required"}, status=400)

        try:
            Exam.objects.get(id=exam_id)
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=400)

        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return JsonResponse({"status": "error", "message": "No file uploaded"}, status=400)

        max_size = 10 * 1024 * 1024
        if uploaded_file.size > max_size:
            return JsonResponse({"status": "error", "message": "File size too large. Maximum allowed is 10MB."}, status=400)

        # Try reading as CSV first, then Excel
        df = None
        file_name = uploaded_file.name.lower()

        try:
            df = pd.read_csv(uploaded_file, dtype=str, on_bad_lines='skip', engine='python')
        except Exception:
            try:
                uploaded_file.seek(0)
            except Exception:
                pass
            try:
                df = pd.read_csv(uploaded_file, dtype=str, on_bad_lines='skip')
            except Exception:
                try:
                    uploaded_file.seek(0)
                except Exception:
                    pass
                # Excel (xls/xlsx)
                if file_name.endswith('.xlsx'):
                    try:
                        df = pd.read_excel(uploaded_file, dtype=str, engine='openpyxl')
                    except Exception:
                        return JsonResponse({"status": "error", "message": "Unable to parse XLSX file. Please use CSV or XLS format."}, status=400)
                else:
                    try:
                        df = pd.read_excel(uploaded_file, dtype=str, engine='xlrd')
                    except Exception as e:
                        return JsonResponse({"status": "error", "message": f"Unable to parse Excel file: {str(e)}"}, status=400)

        if df is None:
            return JsonResponse({"status": "error", "message": "Unable to parse file. Please provide a CSV or XLS file."}, status=400)

        df = df.dropna(how='all').reset_index(drop=True)
        if df.empty:
            return JsonResponse({"status": "error", "message": "File is empty or contains no valid rows."}, status=400)

        df.columns = df.columns.str.strip().str.lower()
        cols = set(df.columns)

        def find_col(candidates):
            for c in candidates:
                if c in cols:
                    return c
            return None

        building_col = find_col(['building', 'building name', 'building_name'])
        room_col = find_col(['room number', 'room_number', 'roomno', 'room no', 'room'])
        cap_col = find_col(['capacity', 'cap', 'seats', 'seat capacity', 'room capacity'])

        if not (building_col and room_col and cap_col):
            return JsonResponse({"status": "error", "message": "File must include columns: Building, Room Number, Capacity."}, status=400)

        rooms = []
        seen = set()
        for idx, row in df.iterrows():
            building = str(row.get(building_col, '')).strip()
            room_number = str(row.get(room_col, '')).strip()
            capacity_raw = row.get(cap_col, '')
            capacity = str(capacity_raw).strip() if pd.notna(capacity_raw) else ''

            if not building or not room_number:
                continue

            try:
                capacity_val = int(float(capacity)) if capacity != '' else 0
            except Exception:
                return JsonResponse({"status": "error", "message": f"Invalid capacity value on row {idx + 2}: '{capacity}'"}, status=400)

            key = (building, room_number)
            if key in seen:
                continue
            seen.add(key)

            rooms.append({
                'building': building,
                'room_number': room_number,
                'capacity': capacity_val
            })

        if not rooms:
            return JsonResponse({"status": "error", "message": "No valid rooms found in file."}, status=400)

        return JsonResponse({"status": "success", "rooms": rooms})

    except Exception as e:
        logger.exception('upload_rooms_file error')
        return JsonResponse({"status": "error", "message": "Internal server error"}, status=500)


# =========================
# Delete single Room (API)
# =========================
@admin_required_json
def delete_room(request):
    """Delete a single room by id. Also removes related seat allocations."""
    if request.method != 'POST':
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)
    try:
        data = json.loads(request.body)
        room_id = data.get('room_id')
        if not room_id:
            return JsonResponse({"status": "error", "message": "room_id is required"}, status=400)

        try:
            room = Room.objects.get(id=room_id)
        except Room.DoesNotExist:
            return JsonResponse({"status": "error", "message": "Room not found"}, status=404)

        # Remove seat allocations explicitly (DB may cascade, but be explicit)
        from .models import SeatAllocation
        SeatAllocation.objects.filter(room=room).delete()

        room.delete()
        logger.info(f"Deleted room {room_id} by admin")
        return JsonResponse({"status": "success", "message": "Room deleted"})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# Room detail & manual edit endpoints
# =========================
@admin_required_json
def get_room_details(request):
    """Return room info, current allocations for the room, and exam students list."""
    if request.method != 'GET':
        return JsonResponse({"status": "error", "message": "GET required"}, status=400)
    try:
        room_id = request.GET.get('room_id')
        if not room_id:
            return JsonResponse({"status": "error", "message": "room_id required"}, status=400)

        room = Room.objects.get(id=room_id)
        from .models import SeatAllocation, ExamStudent

        # Current allocations for this room
        allocs = SeatAllocation.objects.filter(room=room).values(
            'registration_number', 'department', 'seat_code', 'row', 'column', 'exam_date', 'exam_session', 'exam_name'
        )
        allocs_list = list(allocs)

        # Augment allocations with department-level start_time/end_time when available
        for a in allocs_list:
            a_start = ''
            a_end = ''
            try:
                if a.get('department'):
                    de = DepartmentExam.objects.filter(
                        exam=room.exam,
                        department=a.get('department'),
                        exam_date=a.get('exam_date')
                    ).first()
                    if de:
                        if de.start_time:
                            a_start = de.start_time.strftime('%H:%M:%S') if isinstance(de.start_time, time) else str(de.start_time)
                        if de.end_time:
                            a_end = de.end_time.strftime('%H:%M:%S') if isinstance(de.end_time, time) else str(de.end_time)
            except Exception:
                a_start = ''
                a_end = ''
            a['start_time'] = a_start
            a['end_time'] = a_end

        # All exam students for the room's exam - this endpoint returns all students for the exam.
        exam_students_qs = ExamStudent.objects.filter(exam=room.exam).select_related('student')
        exam_students = []
        for es in exam_students_qs:
            exam_students.append({
                'id': es.student.id,
                'registration_number': es.student.registration_number,
                'name': es.student.name,
                'department': es.student.department,
                'semester': es.student.semester
            })

        return JsonResponse({
            'status': 'success',
            'room': {
                'id': room.id,
                'building': room.building,
                'room_number': room.room_number,
                'capacity': room.capacity
            },
            'allocations': allocs_list,
            'exam_students': exam_students
        })
    except Room.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Room not found"}, status=404)
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


@admin_required_json
def update_room_seating(request):
    """Update seating allocations for a single room.

    Payload:
    { room_id: int, seats: [ { seat: 'A1', registration: 'REG123', department: 'CSE', row: 'A', column: 1, exam_date, exam_session, exam_name }, ... ] }
    """
    if request.method != 'POST':
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)
    try:
        data = json.loads(request.body)
        room_id = data.get('room_id')
        seats = data.get('seats', [])
        if not room_id:
            return JsonResponse({"status": "error", "message": "room_id required"}, status=400)

        room = Room.objects.get(id=room_id)
        exam = room.exam
        from .models import SeatAllocation

        created_count = 0
        updated_count = 0

        # Debug log incoming seats
        logger.debug(f"Received {len(seats)} seats for room {room_id}")

        for s in seats:
            reg = (s.get('registration') or '').strip()
            # Ignore placeholder or empty-like values
            if not reg or reg.lower() in ['registration no', 'department', 'empty', '(empty)']:
                continue  # skip empty seats
            
            seat_code = s.get('seat') or ''
            row = (s.get('row') or seat_code[0:1]) if seat_code else ''
            try:
                column = int(s.get('column') or 0)
            except Exception:
                column = 0

            # Use update_or_create keyed by room + seat_code
            # This preserves other seats in the room
            defaults = {
                'exam': exam,
                'registration_number': reg,
                'department': (s.get('department') or '').strip(),
                'row': row,
                'column': column,
                'exam_date': s.get('exam_date') or exam.start_date,
                'exam_session': s.get('exam_session') or 'First Half',
                'exam_name': s.get('exam_name') or exam.name
            }
            obj, created = SeatAllocation.objects.update_or_create(
                room=room,
                seat_code=seat_code,
                defaults=defaults
            )
            if created:
                created_count += 1
            else:
                updated_count += 1

        logger.info(f"Room {room_id}: Created {created_count}, Updated {updated_count} seats")

        return JsonResponse({'status': 'success', 'message': f'Created {created_count}, Updated {updated_count} seats for room {room.room_number}', 'seats_received': len(seats), 'created': created_count, 'updated': updated_count})
    except Room.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Room not found"}, status=404)
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


@admin_required_json
def add_student_to_seat(request):
    """Safely add or update a single student to a seat.
    
    Designed for manual per-seat edits with full metadata support.
    Existing allocations are NOT affected.
    
    Payload: { room_id, seat, registration, department, exam_name, exam_date, 
               exam_session, start_time, end_time, semester, year, row, column }
    
    All exam details (name, date, session, times) can be customized per seat.
    Student details (registration, department, semester, year) can be set per seat.
    """
    if request.method != 'POST':
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)
    
    try:
        data = json.loads(request.body)
        room_id = data.get('room_id')
        seat_code = (data.get('seat') or '').strip()
        reg = (data.get('registration') or '').strip()
        
        if not room_id or not seat_code:
            return JsonResponse({"status": "error", "message": "room_id and seat are required"}, status=400)
        
        # Extract student metadata
        semester = (data.get('semester') or '').strip()
        year = (data.get('year') or '').strip()
        
        # If registration is empty, remove the allocation
        if not reg or reg.lower() in ['registration no', 'department', 'empty', '(empty)']:
            from .models import SeatAllocation
            deleted_count, _ = SeatAllocation.objects.filter(room_id=room_id, seat_code=seat_code).delete()
            return JsonResponse({
                "status": "success",
                "action": "removed",
                "seat": seat_code,
                "message": f"Seat {seat_code} cleared"
            })
        
        room = Room.objects.get(id=room_id)
        from .models import SeatAllocation
        
        # Prepare allocation data with all exam details
        row = (data.get('row') or seat_code[0:1]) if seat_code else ''
        try:
            column = int(data.get('column') or 0)
        except Exception:
            column = 0
        
        # Build defaults with exam metadata
        defaults = {
            'exam': room.exam,
            'registration_number': reg,
            'department': (data.get('department') or '').strip(),
            'row': row,
            'column': column,
            'exam_date': data.get('exam_date') or room.exam.start_date,
            'exam_session': data.get('exam_session') or 'First Half',
            'exam_name': data.get('exam_name') or room.exam.name
        }
        
        # Log detailed student and timing info
        start_time = (data.get('start_time') or '').strip()
        end_time = (data.get('end_time') or '').strip()
        logger.debug(f"Received seat data for seat={seat_code}")
        log_msg = f"Seat {seat_code}: {reg} ({defaults['department']})"
        if semester:
            log_msg += f" Sem {semester}"
        if year:
            log_msg += f" Year {year}"
        if start_time or end_time:
            log_msg += f" [{start_time or 'N/A'} - {end_time or 'N/A'}]"
        logger.info(log_msg)
        
        # Update or create — only affects this specific seat
        obj, created = SeatAllocation.objects.update_or_create(
            room=room,
            seat_code=seat_code,
            defaults=defaults
        )
        
        # If start_time/end_time provided, persist them to DepartmentExam so summary endpoints can return them
        def _parse_time_str(ts):
            if not ts:
                return None
            for fmt in ('%H:%M:%S', '%H:%M'):
                try:
                    return datetime.strptime(ts, fmt).time()
                except Exception:
                    continue
            return None

        parsed_start = _parse_time_str(start_time)
        parsed_end = _parse_time_str(end_time)
        try:
            if (parsed_start is not None) or (parsed_end is not None):
                # Ensure exam_date is a date object
                de_exam_date = defaults.get('exam_date')
                if isinstance(de_exam_date, str):
                    try:
                        de_exam_date = datetime.strptime(de_exam_date, '%Y-%m-%d').date()
                    except Exception:
                        de_exam_date = None

                # Try to update existing DepartmentExam explicitly (if it exists)
                de_qs = DepartmentExam.objects.filter(
                    exam=room.exam,
                    department=defaults.get('department') or '',
                    exam_date=de_exam_date
                )
                if de_qs.exists():
                    de_obj = de_qs.first()
                    changed = False
                    if parsed_start is not None and de_obj.start_time != parsed_start:
                        de_obj.start_time = parsed_start
                        changed = True
                    if parsed_end is not None and de_obj.end_time != parsed_end:
                        de_obj.end_time = parsed_end
                        changed = True
                    if changed:
                        de_obj.save()
                        logger.info(f"Updated DepartmentExam for dept={de_obj.department} date={de_exam_date}")
                    else:
                        logger.debug(f"DepartmentExam already has same times, no update needed")
                else:
                    # Create a new DepartmentExam row
                    de_obj = DepartmentExam.objects.create(
                        exam=room.exam,
                        department=defaults.get('department') or '',
                        exam_name=defaults.get('exam_name') or room.exam.name,
                        paper_code='',
                        exam_date=de_exam_date,
                        session=defaults.get('exam_session') or '',
                        start_time=parsed_start,
                        end_time=parsed_end
                    )
                    logger.info(f"Created DepartmentExam for dept={de_obj.department} date={de_obj.exam_date}")
        except Exception as e:
            logger.error(f"Failed to persist DepartmentExam: {str(e)}")

        action = "created" if created else "updated"
        return JsonResponse({
            "status": "success",
            "action": action,
            "seat": seat_code,
            "registration": reg,
            "department": defaults['department'],
            "semester": semester,
            "year": year,
            "exam_name": defaults['exam_name'],
            "exam_date": str(defaults['exam_date']),
            "exam_session": defaults['exam_session'],
            "start_time": start_time,
            "end_time": end_time,
            "message": f"Seat {seat_code} {action} for student {reg}"
        })
    
    except Room.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Room not found"}, status=404)
    except Exception as e:
        logger.error(f"Error in add_student_to_seat: {str(e)}")
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# Get Uploaded Student Files (API)
# ========================="
@admin_required_json
def get_uploaded_files(request):
    if request.method == "GET":
        try:
            uploaded_files = StudentDataFile.objects.all().order_by("-uploaded_at")
            
            files_data = []
            for file_obj in uploaded_files:
                # StudentDataFile does not store department directly. Use first student branch as department fallback.
                first_student = Student.objects.filter(student_file=file_obj).order_by('id').first()
                dept = first_student.branch if first_student else ''

                files_data.append({
                    'id': file_obj.id,
                    'file_name': file_obj.file_name,
                    'department': dept,
                    # include timestamp string for UI if needed
                    'uploaded_at': file_obj.uploaded_at.strftime('%Y-%m-%d %H:%M') if file_obj.uploaded_at else None,
                    # number of student records attached to this file
                    'student_count': Student.objects.filter(student_file=file_obj).count(),
                })
            
            return JsonResponse({
                "status": "success",
                "files": files_data
            })
        except Exception as e:
            return JsonResponse({
                "status": "error",
                "message": str(e)
            }, status=400)


# =========================
# Save Selected Files for Exam 
# =========================
@admin_required_json
def save_selected_files(request):

    if request.method != "POST":
        return JsonResponse({"status": "error", "message": "POST required"}, status=405)

    try:
        try:
            data = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"status": "error", "message": "Invalid JSON"}, status=400)

        exam_id = data.get("exam_id")
        selected_files = data.get("selected_files", [])

        if not exam_id:
            return JsonResponse({"status": "error", "message": "exam_id missing"}, status=400)

        if not selected_files:
            return JsonResponse({"status": "error", "message": "No files selected"}, status=400)

        # Fetch exam safely
        exam = Exam.objects.filter(id=exam_id).first()
        if not exam:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)

        # Normalize file IDs
        file_ids = [int(fid) for fid in selected_files if str(fid).isdigit()]

        student_files = StudentDataFile.objects.filter(id__in=file_ids)

        if not student_files.exists():
            return JsonResponse({"status": "error", "message": "No valid student files found"}, status=400)

        # ✅ FIX 1 — safer student fetch
        students = Student.objects.filter(
            student_file__in=student_files
        ).select_related("student_file")

        if not students.exists():
            return JsonResponse({"status": "error", "message": "No students found in selected files"}, status=400)

        # ✅ FIX 1.5 — Filter students by semester and department/branch from exam
        from django.db.models import Q
        
        # Get all department exams for this exam
        department_exams = DepartmentExam.objects.filter(exam=exam)
        
        if department_exams.exists():
            # Build filter: student's (semester, branch) must match at least one (semester, department) from exam
            q_filters = Q()
            for dept_exam in department_exams:
                exam_semester = dept_exam.semester
                exam_department = dept_exam.department
                
                if exam_semester:
                    # Match both semester and department/branch
                    q_filters |= Q(semester=exam_semester, branch__icontains=exam_department)
                else:
                    # If semester is not specified, just match by department/branch
                    q_filters |= Q(branch__icontains=exam_department)
            
            # Apply filter only if we have matching criteria
            if q_filters:
                students = students.filter(q_filters)
                print(f"[DEBUG save_selected_files] Filtered {students.count()} students by semester/department from {len(list(department_exams))} department exams")
            else:
                print(f"[DEBUG save_selected_files] No semester/department filters applied")
        else:
            print(f"[DEBUG save_selected_files] No department exams found for exam {exam_id}")

        if not students.exists():
            return JsonResponse({"status": "error", "message": "No students found matching the exam's semester and department criteria. Please check your student data and exam configuration."}, status=400)

        # Remove old allocations
        ExamStudent.objects.filter(exam=exam).delete()

        records = [
            ExamStudent(
                exam=exam,
                student=student,
                student_file=student.student_file
            )
            for student in students
        ]

        # ✅ FIX 2 — safe bulk insert
        if records:
            ExamStudent.objects.bulk_create(records, ignore_conflicts=True)

        # Prepare response
        files_data = []
        for file_obj in student_files:
            count = Student.objects.filter(student_file=file_obj).count()

            files_data.append({
                "file_id": file_obj.id,
                "file_name": file_obj.file_name,
                "student_count": count
            })

        return JsonResponse({
            "status": "success",
            "message": f"{len(records)} students merged successfully",
            "files": files_data,
            "total_students": len(records)
        })

    except Exception as e:
        import traceback
        traceback.print_exc()   # ✅ shows exact error in server log

        return JsonResponse({
            "status": "error",
            "message": f"SERVER ERROR: {str(e)}"
        }, status=500)
# =========================
# Generate Seating Algorithm
# =========================
@admin_required_json
def generate_seating(request):
    """Generate seat allocations based on exam groups and department distribution"""
    from collections import defaultdict
    import random
    import math
    
    if request.method != "POST":
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)
    
    try:
        try:
            data = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"status": "error", "message": "Invalid JSON"}, status=400)

        exam_id = data.get('exam_id')
        if not exam_id:
            return JsonResponse({"status": "error", "message": "exam_id is required"}, status=400)

        exam = Exam.objects.filter(id=exam_id).first()
        if not exam:
            return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)

        # optional global column_map from frontend: list/dict mapping column index (1-5) -> department or null
        column_map = data.get('column_map')
        column_map_provided = bool(column_map)
        col_map_norm = {}
        if column_map_provided:
            if isinstance(column_map, list):
                for idx, val in enumerate(column_map):
                    col_map_norm[idx+1] = val if val not in [None, ''] else None
            elif isinstance(column_map, dict):
                for k, v in column_map.items():
                    try:
                        col_map_norm[int(k)] = v if v not in [None, ''] else None
                    except Exception:
                        continue


        # optional room-specific mapping: { room_id: [col1,col2,...,col5] }
        room_column_map = data.get('room_column_map') or {}
        room_column_map_provided = bool(room_column_map)
        room_col_map_norm = {}
        if room_column_map_provided and isinstance(room_column_map, dict):
            for rk, rv in room_column_map.items():
                try:
                    room_id_i = int(rk)
                except Exception:
                    continue
                # normalize list -> dict
                room_col_map_norm[room_id_i] = {}
                if isinstance(rv, list):
                    for idx, val in enumerate(rv):
                        room_col_map_norm[room_id_i][idx+1] = val if val not in [None, ''] else None
                elif isinstance(rv, dict):
                    for k, v in rv.items():
                        try:
                            room_col_map_norm[room_id_i][int(k)] = v if v not in [None, ''] else None
                        except Exception:
                            continue
        # Note: column-pattern generation removed — ignore any provided patterns unless column_map provided
        exam = Exam.objects.get(id=exam_id)
        
        # Include all students; eligibility is shown in seat metadata
        exam_students_all = ExamStudent.objects.filter(exam=exam).select_related('student')
        exam_students = exam_students_all
        ineligible_count = exam_students_all.filter(student__academic_status__iexact='eligible').count()

        dept_exams = DepartmentExam.objects.filter(exam=exam)
        rooms = list(Room.objects.filter(exam=exam).order_by('id'))
        
        print(f"\n[DEBUG generate_seating] Exam: {exam_id}")
        total_students_all = exam_students_all.count()
        total_students_eligible = ineligible_count
        print(f"[DEBUG] Total exam students (all): {total_students_all}")
        print(f"[DEBUG] Total exam students (eligible): {total_students_eligible}")
        print(f"[DEBUG] Ineligible students (count): {total_students_all - total_students_eligible}")
        print(f"[DEBUG] Student branches: {list(set(s.student.branch for s in exam_students))}")
        print(f"[DEBUG] Total rooms: {len(rooms)}")
        print(f"[DEBUG] DepartmentExam records: {dept_exams.count()}")
        
        if not exam_students.exists():
            return JsonResponse({"status": "error", "message": "No students found"}, status=400)
        if not rooms:
            return JsonResponse({"status": "error", "message": "No rooms configured"}, status=400)
        
        # CHECK: If no DepartmentExam records, that's the problem!
        if not dept_exams.exists():
            student_depts = list(set(s.student.branch for s in exam_students))
            print(f"\n[DEBUG] ⚠ CRITICAL: NO DepartmentExam records for this exam!")
            print(f"[DEBUG] Students have departments: {student_depts}")
            print(f"[DEBUG] Please go back to Step 2 and ADD departments & exams for: {', '.join(student_depts)}")
            return JsonResponse({
                "status": "error", 
                "message": f"NO DEPARTMENTS CONFIGURED! Please go back to Step 2 and add departments & exams.\nYour students are in: {', '.join(student_depts)}"
            }, status=400)
        
        # Build dept_exam_map with normalized department names
        dept_exam_map = {}
        for de in dept_exams:
            dept_key = (de.department or '').strip().upper()
            if not dept_key:
                continue
            if dept_key not in dept_exam_map:
                dept_exam_map[dept_key] = []
            dept_exam_map[dept_key].append({
                'date': de.exam_date,
                'session': de.session,
                'name': de.exam_name,
                'start_time': str(de.start_time) if de.start_time else None,
                'end_time': str(de.end_time) if de.end_time else None
            })
        
        print(f"[DEBUG] DepartmentExam map departments: {list(dept_exam_map.keys())}")
        
        # Group students by (semester, exam_date, session)
        room_groups = defaultdict(list)
        skipped_students = []
        seen_by_slot = defaultdict(set)
        total_group_students = 0

        for exam_student in exam_students:
            student = exam_student.student
            semester = getattr(student, 'semester', '') or ''
            dept_raw = getattr(student, 'branch', '') or ''
            dept = dept_raw.strip().upper()

            if not dept or dept not in dept_exam_map:
                skipped_students.append((student.registration_number, dept_raw))
                print(f"[DEBUG] SKIPPED student {student.registration_number} with dept='{dept_raw}' (not in dept_exam_map)")
                continue

            for dept_exam_info in dept_exam_map[dept]:
                exam_date = dept_exam_info['date']
                session = dept_exam_info['session']
                exam_name = dept_exam_info['name']
                start_time = dept_exam_info.get('start_time')
                end_time = dept_exam_info.get('end_time')

                group_key = (semester, exam_date, session)
                slot_key = (student.registration_number, exam_date, session)

                if slot_key in seen_by_slot[group_key]:
                    # already assigned once for this date/session
                    continue
                seen_by_slot[group_key].add(slot_key)

                student_wrapper = {
                    'id': exam_student.id,
                    'registration_number': student.registration_number,
                    'department': dept,
                    'semester': semester,
                    'exam_date': exam_date,
                    'exam_name': exam_name,
                    'session': session,
                    'start_time': start_time,
                    'end_time': end_time,
                    'is_eligible': str(getattr(student, 'academic_status', '')).strip().lower() == 'eligible',
                    'student': student
                }
                room_groups[group_key].append(student_wrapper)
                total_group_students += 1

        seating_results = defaultdict(list)
        used_room_sessions = set()  # (room_id, exam_date, session)

        def _build_column_assignments(departments):
            if not departments:
                return [None] * 5
            if len(departments) == 1:
                return [departments[0], None, departments[0], None, departments[0]]

            assignments = []
            idx = 0
            for _ in range(5):
                placed = False
                for attempt in range(len(departments)):
                    candidate = departments[(idx + attempt) % len(departments)]
                    if not assignments or candidate != assignments[-1]:
                        assignments.append(candidate)
                        idx = (idx + attempt + 1) % len(departments)
                        placed = True
                        break
                if not placed:
                    assignments.append(departments[0])
            return assignments

        from collections import deque

        for group_key in sorted(room_groups.keys(), key=lambda k: (k[0], str(k[1]), k[2])):
            students_in_group = list(room_groups[group_key])
            semester, exam_date, session = group_key

            # Dedup by reg+date+session
            deduped = []
            seen_reg_slot = set()
            for sw in students_in_group:
                reg = sw.get('registration_number')
                if not reg:
                    continue
                slot_key = (reg, sw.get('exam_date'), sw.get('session'))
                if slot_key in seen_reg_slot:
                    continue
                seen_reg_slot.add(slot_key)
                deduped.append(sw)
            students_in_group = deduped

            dept_queues = {}
            for sw in students_in_group:
                dept = sw.get('department') or 'UNKNOWN'
                dept_queues.setdefault(dept, deque()).append(sw)

            if not dept_queues:
                continue

            available_rooms = [r for r in rooms if (r.id, exam_date, session) not in used_room_sessions]
            if not available_rooms:
                return JsonResponse({
                    "status": "error",
                    "message": f"Not enough rooms available for {exam_date} {session}. Add more rooms or adjust capacities."}, status=400)

            available_rooms = sorted(available_rooms, key=lambda r: int(r.capacity), reverse=True)
            total_remaining = sum(len(q) for q in dept_queues.values())

            room_idx = 0
            while total_remaining > 0:
                if room_idx >= len(available_rooms):
                    return JsonResponse({
                        "status": "error",
                        "message": f"Not enough room capacity for {exam_date} {session}. {total_remaining} students remain unassigned."}, status=400)
                room = available_rooms[room_idx]
                room_idx += 1

                rows = int(room.capacity) // 5
                if rows <= 0:
                    continue

                current_depts = sorted(dept_queues.keys(), key=lambda d: -len(dept_queues[d]))[:5]
                if len(current_depts) == 1:
                    columns_depts = [current_depts[0], None, current_depts[0], None, current_depts[0]]
                else:
                    columns_depts = []
                    idx = 0
                    for _ in range(5):
                        placed = False
                        for attempt in range(len(current_depts)):
                            candidate = current_depts[(idx + attempt) % len(current_depts)]
                            if not columns_depts or candidate != columns_depts[-1]:
                                columns_depts.append(candidate)
                                idx = (idx + attempt + 1) % len(current_depts)
                                placed = True
                                break
                        if not placed:
                            columns_depts.append(current_depts[0])

                for col_index, col_dept in enumerate(columns_depts, start=1):
                    queue = dept_queues.get(col_dept) if col_dept else None
                    for row_idx in range(rows):
                        if queue and len(queue) > 0:
                            sw = queue.popleft()
                            eligible = bool(sw.get('is_eligible'))
                            registration_value = sw.get('registration_number', '')
                            seating_results[room.id].append({
                                'registration': registration_value,
                                'department': col_dept or '',
                                'seat': f"{chr(ord('A') + row_idx)}{col_index}",
                                'row': chr(ord('A') + row_idx),
                                'column': col_index,
                                'exam_date': str(exam_date),
                                'session': session,
                                'exam_name': sw.get('exam_name', ''),
                            'is_eligible': eligible,
                            'start_time': sw.get('start_time', ''),
                            'end_time': sw.get('end_time', ''),
                            'semester': sw.get('semester', '')
                        })
                            total_remaining -= 1
                        else:
                            seating_results[room.id].append({
                                'registration': 'Empty',
                                'department': '',
                                'seat': f"{chr(ord('A') + row_idx)}{col_index}",
                                'row': chr(ord('A') + row_idx),
                                'column': col_index,
                                'exam_date': str(exam_date),
                                'session': session,
                                'exam_name': '',
                            'is_eligible': False,
                            'start_time': '',
                            'end_time': '',
                            'semester': ''
                        })

                used_room_sessions.add((room.id, exam_date, session))
                dept_queues = {d: q for d, q in dept_queues.items() if q}

                if total_remaining <= 0:
                    break

            if any(len(q) > 0 for q in dept_queues.values()):
                return JsonResponse({
                    "status": "error",
                    "message": "Some students are not allocated. Not enough rooms for this date/session."}, status=400)

        # Final allocation validation
        allocated_students = sum(
            1
            for room_id in seating_results
            for s in seating_results[room_id]
            if s.get('registration') not in ['Empty']
        )
        if allocated_students != total_group_students:
            return JsonResponse({
                "status": "error",
                "message": "Some students are not allocated or allocation mismatch."
            }, status=400)

        response_rooms = []
        print(f"[DEBUG] Building response_rooms from {len(rooms)} rooms")
        print(f"[DEBUG] seating_results keys (room IDs with seats): {list(seating_results.keys())}")

        response_rooms = []
        print(f"[DEBUG] Building response_rooms from {len(rooms)} rooms")
        print(f"[DEBUG] seating_results keys (room IDs with seats): {list(seating_results.keys())}")
        
        for room in rooms:
            print(f"[DEBUG] Checking room {room.id} (Building: {room.building}, Room: {room.room_number})")
            if room.id in seating_results:
                seats = seating_results[room.id]
                print(f"[DEBUG]   ✓ Found {len(seats)} seats for this room")

                # First, get all departments that actually have students in this room
                room_departments_with_students = set()
                for s in seats:
                    if s.get('registration') and s.get('registration') != 'Empty' and s.get('department'):
                        room_departments_with_students.add(s.get('department').strip().upper())
                
                print(f"[DEBUG]   Departments with actual students in room: {room_departments_with_students}")

                # Build clean dept list and exam details ONLY for departments with students
                dept_set = set()
                dept_details = []
                seen_details = set()
                for s in seats:
                    d = str(s.get('department') or '').strip().upper()
                    if not d or d.lower() == 'empty':
                        continue
                    
                    # CRITICAL: Only include if this department has actual students in this room
                    if d not in room_departments_with_students:
                        print(f"[DEBUG]   ⚠ SKIPPING department '{d}' - no actual students in this room")
                        continue
                    
                    dept_set.add(d)
                    key = f"{d}||{s.get('exam_name','')}||{s.get('exam_date','')}||{s.get('session','')}||{s.get('start_time','')}||{s.get('end_time','')}||{s.get('semester','')}"
                    if key not in seen_details:
                        seen_details.add(key)
                        dept_details.append({
                            'department': d,
                            'semester': s.get('semester',''),
                            'exam_name': s.get('exam_name','N/A'),
                            'exam_date': s.get('exam_date','N/A'),
                            'session': s.get('session','N/A'),
                            'start_time': s.get('start_time','N/A'),
                            'end_time': s.get('end_time','N/A')
                        })

                response_rooms.append({
                    'id': room.id,
                    'building': room.building,
                    'room_number': room.room_number,
                    'capacity': room.capacity,
                    'departments': sorted(list(dept_set)),
                    'department_details': dept_details,
                    'seats': seats
                })
            else:
                print(f"[DEBUG]   ✗ No seats found for this room")
        
        print(f"\n[DEBUG] ===== SEATING GENERATION SUMMARY =====")
        print(f"[DEBUG] DepartmentExam departments: {list(dept_exam_map.keys())}")
        print(f"[DEBUG] Total exam students: {exam_students.count()}")
        print(f"[DEBUG] Skipped students: {len(skipped_students)}")
        if skipped_students:
            for reg, dept in skipped_students[:10]:  # Show first 10
                print(f"[DEBUG]   ✗ {reg} has dept='{dept}' (NOT IN DEPARTMENTEXAM)")
            if len(skipped_students) > 10:
                print(f"[DEBUG]   ... and {len(skipped_students) - 10} more")
        
        print(f"[DEBUG] Room groups created: {len(room_groups)}")
        print(f"[DEBUG] Total rooms with seating: {len(response_rooms)}")
        total_seats = sum(len(r.get('seats', [])) for r in response_rooms)
        print(f"[DEBUG] Total seats allocated: {total_seats}")
        
        # CRITICAL: If ALL students were skipped, return error
        if len(skipped_students) == exam_students.count():
            print(f"[DEBUG] ✗ CRITICAL: ALL {exam_students.count()} STUDENTS WERE SKIPPED!")
            print(f"[DEBUG] Department mismatch between student file and Step 2 departments")
            student_depts_in_file = list(set(s.student.branch for s in exam_students))
            configured_depts = list(dept_exam_map.keys())
            print(f"[DEBUG] Departments in student file: {student_depts_in_file}")
            print(f"[DEBUG] Departments in Step 2: {configured_depts}")
            print(f"[DEBUG] ==========================================\n")
            return JsonResponse({
                "status": "error",
                "message": f"DEPARTMENT MISMATCH!\nStudents in file: {student_depts_in_file}\nConfigured in Step 2: {configured_depts}\nMake sure department names match EXACTLY (case-sensitive)!"
            }, status=400)
        
        if len(response_rooms) == 0 and len(skipped_students) > 0:
            print(f"[DEBUG] ⚠ WARNING: NO SEATING DATA! Some students were skipped due to department mismatch!")
        print(f"[DEBUG] ==========================================\n")
        
        # Final validation before returning
        if not response_rooms:
            print("[DEBUG] ✗ CRITICAL: response_rooms is empty!")
        else:
            print(f"[DEBUG] ✓ response_rooms has {len(response_rooms)} rooms")
            for idx, r in enumerate(response_rooms[:1]):  # Show first room
                print(f"[DEBUG] Room {idx} keys: {r.keys()}")
                print(f"[DEBUG] Room {idx} has {len(r.get('seats', []))} seats")
                if r.get('seats'):
                    print(f"[DEBUG] First seat keys: {r['seats'][0].keys()}")
        
        # ===== SAVE SEATING TO DATABASE =====
        print(f"[DEBUG] Saving seating allocations to database...")
        SeatAllocation.objects.filter(exam=exam).delete()  # Clear previous allocations
        
        seat_allocations = []
        seen_allocations = set()
        for room in response_rooms:
            for seat in room['seats']:
                # Extract row and column from seat data
                row = seat.get('row', 'A')
                column = seat.get('column', 1)
                reg = seat.get('registration', '')
                exam_date = seat.get('exam_date', '')
                exam_session = seat.get('session', '')
                exam_name = seat.get('exam_name', '')

                duplicate_key = (room['id'], reg, exam_date, exam_session, exam_name)
                if duplicate_key in seen_allocations:
                    print(f"[DEBUG] Skipping duplicate allocation: {duplicate_key}")
                    continue
                seen_allocations.add(duplicate_key)

                print(f"[DEBUG] Creating SeatAllocation: reg={reg}, row={row}, column={column}, seat_code={seat.get('seat')}")
                
                sa = SeatAllocation(
                    exam=exam,
                    room_id=room['id'],
                    registration_number=reg,
                    department=seat.get('department', ''),
                    seat_code=seat.get('seat', ''),
                    row=row,
                    column=column,
                    exam_date=exam_date,
                    exam_session=exam_session,
                    exam_name=exam_name
                )
                seat_allocations.append(sa)
        
        SeatAllocation.objects.bulk_create(seat_allocations, ignore_conflicts=True)
        print(f"[DEBUG] Saved {len(seat_allocations)} seat allocations to database (ignore_conflicts=True)")
        
        return JsonResponse({
            "status": "success", 
            "message": "Seating generated", 
            "rooms": response_rooms,
            "total_students": exam_students.count(),
            "total_seats_allocated": total_seats,
            "total_rooms": len(response_rooms)
        })
    
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# Get Seating Data
# =========================
@admin_required_json
def get_seating_data(request, exam_id):
    """Fetch existing seating allocations for display"""
    try:
        exam = Exam.objects.get(id=exam_id)
        rooms = Room.objects.filter(exam=exam)
        
        response_rooms = []
        for room in rooms:
            room_info = {
                'id': room.id,
                'building': room.building,
                'room_number': room.room_number,
                'capacity': room.capacity,
                'seats': []
            }
            response_rooms.append(room_info)
        
        return JsonResponse({"status": "success", "rooms": response_rooms})
    except Exam.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


@admin_required_json
def lock_seating(request):
    """Save seating allocation to database"""
    if request.method != "POST":
        return JsonResponse({"status": "error", "message": "POST required"}, status=400)
    
    try:
        data = json.loads(request.body)
        exam_id = data.get('exam_id')
        seating_data = data.get('seating_data', [])
        
        exam = Exam.objects.get(id=exam_id)
        
        # Clear existing allocations
        SeatAllocation.objects.filter(exam=exam).delete()
        
        # Save all seat allocations
        allocations = []
        for room_data in seating_data:
            room_id = room_data.get('id')
            try:
                room = Room.objects.get(id=room_id)
            except:
                continue
            
            seats = room_data.get('seats', [])
            for seat in seats:
                allocation = SeatAllocation(
                    exam=exam,
                    room=room,
                    registration_number=seat.get('registration', ''),
                    department=seat.get('department', ''),
                    seat_code=seat.get('seat', ''),
                    row=seat.get('row', ''),
                    column=int(seat.get('column', 0)) if seat.get('column') else 0,
                    exam_date=seat.get('exam_date') or exam.start_date,
                    exam_session=seat.get('session', 'First Half'),
                    exam_name=seat.get('exam_name', exam.name)
                )
                allocations.append(allocation)
        
        # Bulk create
        SeatAllocation.objects.bulk_create(allocations, ignore_conflicts=True)
        
        # DO NOT mark exam as completed here!
        # Exam should only be marked as completed when user clicks "Complete Setup" button
        # at Step 6. This lock_seating just saves the seating, nothing more.
        
        return JsonResponse({
            "status": "success",
            "message": f"{len(allocations)} seats saved to database"
        })
    except Exam.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# STEP 6 - GET EXAM SUMMARY
# =========================
# STEP 6 - GET EXAM SUMMARY
# =========================
def get_exam_summary(request):
    """Fetch complete exam summary for Step 6 verification"""
    try:
        exam_id = request.GET.get('exam_id')
        if not exam_id:
            return JsonResponse({"status": "error", "message": "exam_id required"}, status=400)
        
        try:
            exam = Exam.objects.get(id=exam_id)
        except Exam.DoesNotExist:
            return JsonResponse({"status": "error", "message": f"Exam with ID {exam_id} not found"}, status=404)
        
        # 1. Exam details
        exam_data = {
            "id": exam.id,
            "name": exam.name or "",
            "start_date": str(exam.start_date) if exam.start_date else "",
            "end_date": str(exam.end_date) if exam.end_date else "",
            "schedule_file_name": getattr(exam, 'schedule_file_name', None) or "",
            "rooms_file_name": getattr(exam, 'rooms_file_name', None) or ""
        }
        
        # 2. Departments & Exams
        departments_data = []
        try:
            departments = exam.departments.all().values(
                'department', 'exam_name', 'paper_code', 'exam_date', 'session', 'start_time', 'end_time', 'semester'
            )
            departments_data = list(departments)
        except Exception as e:
            print(f"[DEBUG] Error loading departments: {e}")
            departments_data = []
        
        # 3. Rooms - keep full rooms list for potential filtering after seat data is read
        room_data_all = []
        try:
            room_data_all = list(exam.rooms.all().values('id', 'building', 'room_number', 'capacity'))
        except Exception as e:
            print(f"[DEBUG] Error loading rooms: {e}")
            room_data_all = []

        # 4. Student Files used
        student_files_data = []
        try:
            exam_students = ExamStudent.objects.filter(exam=exam).select_related('student_file')
            student_file_ids = set()
            for es in exam_students:
                student_file_ids.add(es.student_file_id)
            
            for file_id in student_file_ids:
                try:
                    student_file = StudentDataFile.objects.get(id=file_id)
                    student_count = ExamStudent.objects.filter(exam=exam, student_file_id=file_id).count()
                    student_files_data.append({
                        'id': student_file.id,
                        'file_name': student_file.file_name,
                        'student_count': student_count,
                        'year': '',
                        'semester': '',
                        'department': ''
                    })
                except StudentDataFile.DoesNotExist:
                    continue
        except Exception as e:
            print(f"[DEBUG] Error loading student files: {e}")
            student_files_data = []
        
        # 5. Seating arrangement
        seating_data = []
        allocated_room_ids = set()
        # Build student eligibility map from ExamStudent/Student to preserve eligibility status
        student_eligibility = {}
        student_semester = {}
        try:
            exam_students = ExamStudent.objects.filter(exam=exam).select_related('student')
            for es in exam_students:
                reg = (es.student.registration_number or '').strip().upper()
                if reg:
                    student_eligibility[reg] = str(getattr(es.student, 'academic_status', '')).strip().lower() == 'eligible'
                    student_semester[reg] = str(getattr(es.student, 'semester', '')).strip()
        except Exception as e:
            print(f"[DEBUG] Error building student maps: {e}")
            student_eligibility = {}
            student_semester = {}

        # Build a quick lookup for department exam start/end/semester times
        dept_exam_lookup = {}
        try:
            for de in DepartmentExam.objects.filter(exam=exam):
                key = (str(de.department or '').strip().upper(), str(de.exam_date or ''), str(de.session or ''))
                dept_exam_lookup[key] = {
                    'start_time': str(de.start_time) if de.start_time else '',
                    'end_time': str(de.end_time) if de.end_time else '',
                    'semester': str(de.semester).strip() if de.semester else ''
                }
        except Exception as e:
            print(f"[DEBUG] Error building department exam lookup: {e}")
            dept_exam_lookup = {}

        try:
            seating_queryset = SeatAllocation.objects.filter(exam=exam).select_related('room')
            seating_count = seating_queryset.count()
            print(f"[DEBUG] SeatAllocation count for exam {exam.id}: {seating_count}")

            for seat in seating_queryset:
                try:
                    allocated_room_ids.add(seat.room_id)
                    reg = (seat.registration_number or '').strip()
                    reg_upper = reg.upper()
                    is_eligible = False
                    if reg_upper and reg_upper != 'EMPTY':
                        is_eligible = student_eligibility.get(reg_upper, False)

                    key = (str(seat.department or '').strip().upper(), str(seat.exam_date or ''), str(seat.exam_session or ''))
                    dept_times = dept_exam_lookup.get(key, {'start_time': '', 'end_time': ''})

                    seating_data.append({
                        'room_id': seat.room_id,
                        'room_building': seat.room.building if seat.room else "",
                        'room_number': seat.room.room_number if seat.room else "",
                        'row': seat.row or '',
                        'column': seat.column or 0,
                        'seat': seat.seat_code or '',
                        'registration': reg or '',
                        'department': seat.department or '',
                        'exam_date': str(seat.exam_date) if seat.exam_date else '',
                        'session': seat.exam_session or '',
                        'exam_name': seat.exam_name or '',
                        'start_time': dept_times.get('start_time', ''),
                        'end_time': dept_times.get('end_time', ''),
                        'semester': dept_times.get('semester', ''),
                        'student_semester': student_semester.get(reg_upper, ''),
                        'year': '',
                        'is_eligible': is_eligible
                    })
                except Exception as e:
                    print(f"[DEBUG] Error processing seat {getattr(seat, 'seat_code', '?')}: {e}")
                    continue

            print(f"[DEBUG] Processed {len(seating_data)} seats successfully")

        except Exception as e:
            print(f"[DEBUG] Error in seating query: {e}")
            import traceback
            traceback.print_exc()
            seating_data = []
            allocated_room_ids = set()

        # Build rooms_data with seats and department details from actual allocated seats.
        rooms_data = []
        for r in room_data_all:
            if r.get('id') not in allocated_room_ids:
                continue

            room_seats = [s for s in seating_data if s.get('room_id') == r.get('id')]
            if not room_seats:
                continue

            # Determine departments with actual students in room
            room_departments = set()
            for s in room_seats:
                if s.get('registration') and s.get('registration') != 'Empty' and s.get('department'):
                    room_departments.add(str(s.get('department')).strip().upper())

            dept_details = []
            seen_details = set()
            for s in room_seats:
                dept = str(s.get('department') or '').strip()
                if not dept or dept.upper() == 'EMPTY':
                    continue
                dept_key = dept.strip().upper()
                if dept_key not in room_departments:
                    continue

                detail_key = f"{dept_key}||{s.get('exam_name','')}||{s.get('exam_date','')}||{s.get('session','')}||{s.get('start_time','')}||{s.get('end_time','')}"
                if detail_key in seen_details:
                    continue
                seen_details.add(detail_key)

                dept_details.append({
                    'department': dept,
                    'semester': s.get('student_semester',''),
                    'exam_name': s.get('exam_name','N/A'),
                    'exam_date': s.get('exam_date','N/A'),
                    'session': s.get('session','N/A'),
                    'start_time': s.get('start_time','N/A'),
                    'end_time': s.get('end_time','N/A')
                })

            rooms_data.append({
                'id': r.get('id'),
                'building': r.get('building'),
                'room_number': r.get('room_number'),
                'capacity': r.get('capacity'),
                'departments': sorted(list(room_departments)),
                'department_details': dept_details,
                'seats': room_seats
            })
        print(f"[DEBUG] Returning {len(rooms_data)} rooms with seat allocations (from {len(room_data_all)} total rooms)")
        
        total_students = ExamStudent.objects.filter(exam=exam).count()
        total_seats = len(seating_data)
        
        return JsonResponse({
            "status": "success",
            "exam": exam_data,
            "departments": departments_data,
            "rooms": rooms_data,
            "student_files": student_files_data,
            "seating": seating_data,
            "total_students": total_students,
            "total_seats_allocated": total_seats
        })
        
    except Exception as e:
        print(f"[DEBUG] Outer error in get_exam_summary: {e}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"status": "error", "message": f"Server error: {str(e)}"}, status=500)


def view_exam(request, exam_id):
    """
    Renders a page showing seating layout for the given exam.
    The page will fetch seating data via the existing `get_exam_summary` API.
    """
    try:
        exam = Exam.objects.get(id=exam_id)
    except Exam.DoesNotExist:
        return redirect('dashboard')
    return render(request, 'core/view_exam.html', {
        'exam_id': exam_id,
        'exam_name': exam.name,
        'start_date': str(exam.start_date) if exam.start_date else '',
        'end_date': str(exam.end_date) if exam.end_date else ''
    })


# =========================
# STUDENT PORTAL - VIEW SEATING
# =========================
def student_portal(request):
    """Student portal to view exam seating - UNIVERSAL (no exam_id needed)"""
    return render(request, 'core/student_portal.html')


def get_student_info(request):
    """API endpoint to get student info and their exams with times from database"""
    try:
        reg_number = request.GET.get('reg_number', '').strip()
        
        if not reg_number:
            return JsonResponse({"status": "error", "message": "Registration number is required"}, status=400)
        
        # Find the student
        student = Student.objects.filter(registration_number=reg_number).first()
        
        if not student:
            return JsonResponse({"status": "error", "message": "Student not found"}, status=404)
        
        # Get all seat allocations for this student
        allocations = SeatAllocation.objects.filter(registration_number=reg_number)
        
        if not allocations.exists():
            return JsonResponse({"status": "error", "message": "No seat allocations found for this student"}, status=404)
        
        exams = []
        seen_exams = set()
        
        for alloc in allocations:
            # Skip if we already have this exam
            exam_key = (alloc.exam.id, alloc.exam_date)
            if exam_key in seen_exams:
                continue
            seen_exams.add(exam_key)
            
            # Get DepartmentExam to fetch start_time and end_time
            dept_exam = DepartmentExam.objects.filter(
                exam=alloc.exam,
                department=student.department,
                exam_date=alloc.exam_date
            ).first()
            
            start_time_str = ''
            end_time_str = ''
            paper_code = ''
            
            if dept_exam:
                if dept_exam.start_time:
                    start_time_str = dept_exam.start_time.strftime('%H:%M') if isinstance(dept_exam.start_time, time) else str(dept_exam.start_time)
                if dept_exam.end_time:
                    end_time_str = dept_exam.end_time.strftime('%H:%M') if isinstance(dept_exam.end_time, time) else str(dept_exam.end_time)
                paper_code = dept_exam.paper_code or ''
            
            exam_data = {
                'exam_id': alloc.exam.id,
                'exam_name': alloc.exam_name or (dept_exam.exam_name if dept_exam else alloc.exam.name),
                'paper_code': paper_code,
                'exam_date': str(alloc.exam_date) if alloc.exam_date else '',
                'start_time': start_time_str,
                'end_time': end_time_str,
            }
            exams.append(exam_data)
        
        student_info = {
            'name': student.name,
            'department': student.department,
            'year': student.year,
            'semester': student.semester,
        }
        
        return JsonResponse({
            "status": "success",
            "student_info": student_info,
            "exams": exams
        })
    
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# QR Code Endpoints
# =========================
from django.urls import reverse
from django.http import HttpResponse
from io import BytesIO
import qrcode


def generate_qr(request):
    """Return a PNG QR image. Query params:
        - type=student_portal (default) => points to student_portal page
        - data=<url> => generate QR for given absolute URL
    """
    try:
        qr_type = request.GET.get('type', 'student_portal')
        if qr_type == 'student_portal':
            target_url = request.build_absolute_uri(reverse('student_portal'))
        else:
            target_url = request.GET.get('data') or request.build_absolute_uri(reverse('student_portal'))

        img = qrcode.make(target_url)
        buf = BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        response = HttpResponse(buf.getvalue(), content_type='image/png')
        response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)


def qr_page(request):
    """Render a standalone page that shows the universal QR (points to student portal)."""
    from django.conf import settings
    
    # Get configured URL from settings (read from .env in production)
    student_portal_url = settings.STUDENT_PORTAL_URL
    
    # Ensure URL uses HTTPS in production
    if settings.SECURE_SSL_REDIRECT and not student_portal_url.startswith('https'):
        student_portal_url = student_portal_url.replace('http://', 'https://')
    
    qr_url = f"{student_portal_url}?qr=1"
    
    return render(request, 'core/qr_page.html', {
        'qr_url': qr_url,
        'student_portal_url': student_portal_url
    })


def get_student_seat(request):
    """API endpoint to get student's seat information - with date/time validation
    Shows seat only if: today's date == exam_date AND current_time is within (exam_start - 15 min) to exam_end
    """
    try:
        reg_number = request.GET.get('reg_number', '').strip()
        
        if not reg_number:
            return JsonResponse({"status": "error", "message": "Registration number is required"}, status=400)
        
        # Find the seat allocation for this Student AND specific exam_id
        exam_id = request.GET.get('exam_id', '')
        if not exam_id:
            return JsonResponse({"status": "error", "message": "Exam ID is required"}, status=400)
        
        # Convert exam_id to integer
        try:
            exam_id = int(exam_id)
        except ValueError:
            return JsonResponse({"status": "error", "message": "Invalid exam ID format"}, status=400)
        
        # Get exam_date from request (student may have multiple exams on different dates)
        exam_date_param = request.GET.get('exam_date', '')
        
        # Build filter query
        filter_params = {
            'registration_number': reg_number,
            'exam_id': exam_id
        }
        
        # If exam_date is provided, use it to filter for the specific exam date
        if exam_date_param:
            try:
                exam_date_obj = datetime.strptime(exam_date_param, '%Y-%m-%d').date()
                filter_params['exam_date'] = exam_date_obj
            except ValueError:
                pass  # Ignore invalid date format, filter without it
        
        seat = SeatAllocation.objects.filter(**filter_params).first()
        
        if not seat:
            return JsonResponse({"status": "error", "message": "No seating assignment found"}, status=404)
        
        # Check if exam is accessible (date and time validation)
        # Use timezone-aware date for accurate comparison in IST
        from django.utils import timezone as django_timezone
        from zoneinfo import ZoneInfo
        
        # Get current date and time in IST timezone
        ist = ZoneInfo('Asia/Kolkata')
        now_ist = django_timezone.now().astimezone(ist)
        today = now_ist.date()
        exam_date = seat.exam_date
        
        # Log for debugging timezone issues
        logger.info(f"[SEAT ACCESS] Reg: {reg_number}, Exam: {exam_id}, Server time (IST): {now_ist}, Today (IST): {today}, Exam date: {exam_date}")
        
        # Get exam times from DepartmentExam
        student = Student.objects.filter(registration_number=reg_number).first()
        dept_exam = DepartmentExam.objects.filter(
            exam_id=exam_id,
            department=seat.department,
            exam_date=exam_date
        ).first()
        
        # Format times for display - use correct field names expected by frontend
        exam_start_time = ''
        exam_end_time = ''
        access_start_time = ''
        
        if dept_exam:
            if dept_exam.start_time:
                exam_start_time = dept_exam.start_time.strftime('%H:%M')
                # Access starts 15 minutes before exam
                start_dt = datetime.combine(today, dept_exam.start_time)
                access_dt = start_dt - timedelta(minutes=15)
                access_start_time = access_dt.strftime('%H:%M')
            if dept_exam.end_time:
                exam_end_time = dept_exam.end_time.strftime('%H:%M')
        
        # Prepare seat data - always include for error handling too
        seat_data = {
            'registration_number': seat.registration_number,
            'department': seat.department,
            'seat_code': seat.seat_code,
            'room_building': seat.room.building,
            'room_number': seat.room.room_number,
            'room_capacity': seat.room.capacity,
            'exam_date': str(seat.exam_date) if seat.exam_date else '',
            'exam_session': seat.exam_session or 'First Half',
            'exam_name': seat.exam_name or '',
            'exam_start_time': exam_start_time,
            'exam_end_time': exam_end_time,
            'access_start_time': access_start_time,
            'room_occupied_seats': []
        }
        
        # Check date match first
        if exam_date != today:
            # This is a future/past exam
            is_future = exam_date > today
            response = JsonResponse({
                "status": "error",
                "message": f"Exam is scheduled for {exam_date}, not today ({today})",
                "exam_id": exam_id,
                "requested_exam_id": exam_id,
                "is_future": is_future,
                "is_expired": not is_future,
                "is_early": False,
                "exam_date": str(exam_date),
                "exam_start_time": exam_start_time,
                "exam_end_time": exam_end_time,
                "seat": seat_data
            }, status=403)
            response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            return response
        
        # Check time window (exam_start - 15 min) to exam_end
        # Use timezone-aware datetime for accurate comparison
        from django.utils import timezone as django_timezone
        from zoneinfo import ZoneInfo
        
        # Get IST timezone
        ist = ZoneInfo('Asia/Kolkata')
        now = now_ist  # Use the now_ist we already calculated above
        
        # Log for debugging
        logger.info(f"[TIME CHECK] Current time (IST): {now}, Access start: {access_start_time}, Exam end: {exam_end_time}")
        
        # Check if current time is within valid window
        if access_start_time and exam_end_time:
            # Combine exam date with times to create timezone-aware datetimes in IST
            access_start_naive = datetime.combine(exam_date, datetime.strptime(access_start_time, '%H:%M').time())
            exam_end_naive = datetime.combine(exam_date, datetime.strptime(exam_end_time, '%H:%M').time())
            
            # Handle midnight crossing: if end time < start time, exam ends next day
            if exam_end_naive <= access_start_naive:
                exam_end_naive = exam_end_naive + timedelta(days=1)
            
            # Make them timezone-aware in IST
            access_start_dt = access_start_naive.replace(tzinfo=ist)
            exam_end_dt = exam_end_naive.replace(tzinfo=ist)
            
            logger.info(f"[TIME CHECK] Access start datetime (IST): {access_start_dt}, Exam end datetime (IST): {exam_end_dt}")
            
            if now < access_start_dt:
                # Exam hasn't started yet (time window not opened)
                time_diff = access_start_dt - now
                minutes_to_wait = int(time_diff.total_seconds() // 60)
                response = JsonResponse({
                    "status": "error",
                    "message": f"Exam access opens at {access_start_time}",
                    "exam_id": exam_id,
                    "requested_exam_id": exam_id,
                    "is_future": False,
                    "is_expired": False,
                    "is_early": True,
                    "minutes_to_wait": minutes_to_wait,
                    "exam_start_time": exam_start_time,
                    "exam_end_time": exam_end_time,
                    "seat": seat_data
                }, status=403)
                response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                return response
            
            if now > exam_end_dt:
                # Exam has ended
                response = JsonResponse({
                    "status": "error",
                    "message": f"The exam ended at {exam_end_time}. Seat information is no longer available.",
                    "exam_id": exam_id,
                    "requested_exam_id": exam_id,
                    "is_future": False,
                    "is_expired": True,
                    "is_early": False,
                    "exam_end_time": exam_end_time,
                    "seat": seat_data
                }, status=403)
                response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                return response
        
        # Get all other seats in the same room for this exam/session
        room_id = seat.room.id
        exam_session = seat.exam_session
        
        # Find all occupied seats in this room for the same exam/session/date
        occupied_seats = SeatAllocation.objects.filter(
            room_id=room_id,
            exam_date=exam_date,
            exam_session=exam_session
        ).values_list('seat_code', flat=True)
        
        occupied_seats_list = list(occupied_seats)
        seat_data['room_occupied_seats'] = occupied_seats_list
        
        response = JsonResponse({
            "status": "success",
            "exam_id": exam_id,
            "requested_exam_id": exam_id,
            "seat": seat_data
        })
        response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response
    
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


# =========================
# Helper Function: Determine Exam Status
# =========================
from datetime import date

def get_exam_status(exam):
    """
    Determines exam status based on current date vs exam dates.
    Returns one of: 'upcoming', 'ongoing', 'expired', 'incomplete'
    If the exam is missing start_date or end_date, returns 'incomplete' and logs a warning.
    """
    today = date.today()
    start_date = exam.start_date
    end_date = exam.end_date
    
    # Guard against missing dates
    if start_date is None or end_date is None:
        logger.warning(f"Exam {exam.id} ('{exam.name}') missing start_date or end_date")
        return 'incomplete'
    
    if today < start_date:
        return 'upcoming'
    elif start_date <= today <= end_date:
        return 'ongoing'
    else:
        return 'expired'


# =========================
# Delete Expired Exams (Auto Cleanup)
# =========================
def cleanup_expired_exams():
    """
    Deletes all exams that have ended (end_date < today).
    Called on dashboard load to auto-clean old exams.
    """
    today = date.today()
    expired_exams = Exam.objects.filter(end_date__lt=today, is_completed=True)
    count = expired_exams.count()
    
    if count > 0:
        logger.info(f'Deleting {count} expired exams...')
        for exam in expired_exams:
            logger.debug(f'Deleting exam: {exam.name} (ID: {exam.id}) - Ended on {exam.end_date}')
        expired_exams.delete()
        logger.info(f'Successfully deleted {count} expired exams')
    
    return count


# =========================
@admin_required_json
def get_all_exams(request):
    """
    Returns all permanent exams with details for dashboard display.
    Includes: exam name, departments, student count, start_date, end_date, duration, status
    Auto-deletes expired exams on each call.
    """
    try:
        # Auto-cleanup expired exams before returning
        cleanup_expired_exams()
        
        # DEBUG: Check all exams first
        all_exams = Exam.objects.all()
        logger.debug(f'Total exams in DB: {all_exams.count()}')
        for exam in all_exams:
            logger.debug(f'  - {exam.id}: {exam.name} | is_completed={exam.is_completed}, is_temporary={exam.is_temporary}')
        
        # Get all permanent exams
        exams = Exam.objects.filter(is_completed=True, is_temporary=False)
        logger.info(f'Found {exams.count()} permanent exams (is_completed=True AND is_temporary=False)')
        
        exam_list = []
        for exam in exams:
            logger.debug(f'Processing exam: {exam.name} (ID: {exam.id})')
            
            # Get unique departments for this exam (remove duplicates)
            dept_exams = DepartmentExam.objects.filter(exam=exam)
            departments = sorted(set([de.department for de in dept_exams]))
            
            # Get student count
            exam_students = ExamStudent.objects.filter(exam=exam)
            student_count = exam_students.count()
            
            # Calculate duration in days (guard against missing dates)
            if exam.start_date is None or exam.end_date is None:
                logger.warning(f"Exam {exam.id} ('{exam.name}') missing start_date or end_date")
                duration_days = None
            else:
                duration_days = (exam.end_date - exam.start_date).days
            
            # Ignore poorly configured exams that are essentially empty (temp artifacts)
            if student_count == 0 and not departments and duration_days is None:
                logger.info(f'Skipping empty exam {exam.id} ({exam.name}) from dashboard results')
                continue
            
            # Determine exam status
            status = get_exam_status(exam)
            
            exam_data = {
                'id': exam.id,
                'name': exam.name,
                'departments': departments,
                'student_count': student_count,
                'start_date': str(exam.start_date) if exam.start_date else '',
                'end_date': str(exam.end_date) if exam.end_date else '',
                'duration_days': duration_days,
                'status': status
            }
            logger.debug(f'Exam data prepared: {exam_data}')
            exam_list.append(exam_data)
        
        logger.info(f'Returning {len(exam_list)} exams')
        return JsonResponse({
            'status': 'success',
            'exams': exam_list
        })
    
    except Exception as e:
        logger.error(f"Exception in get_all_exams: {str(e)}", exc_info=True)
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=400)
        return JsonResponse({
            'status': 'error',
            'message': str(e)
        }, status=400)


# DEBUG: Simple test endpoint
@admin_required_json
def test_api(request):
    logger.info('test_api endpoint called')
    try:
        exams = Exam.objects.filter(is_completed=True, is_temporary=False)
        count = exams.count()
        logger.debug(f'Found {count} exams')
        return JsonResponse({
            'message': 'API is working',
            'exam_count': count,
            'exams': [{'id': e.id, 'name': e.name} for e in exams]
        })
    except Exception as e:
        logger.error(f"Error in test_api: {str(e)}", exc_info=True)
        return JsonResponse({'error': str(e)})

@admin_required_json
def debug_department_exams(request):
    """Debug endpoint: list DepartmentExam rows for an exam (optional filter by department)."""
    try:
        exam_id = request.GET.get('exam_id')
        dept = request.GET.get('department')
        if not exam_id:
            return JsonResponse({'status': 'error', 'message': 'exam_id required'}, status=400)
        try:
            exam_id = int(exam_id)
        except Exception:
            return JsonResponse({'status': 'error', 'message': 'Invalid exam_id'}, status=400)

        qs = DepartmentExam.objects.filter(exam_id=exam_id)
        if dept:
            qs = qs.filter(department__iexact=dept)

        rows = []
        for d in qs:
            rows.append({
                'id': d.id,
                'department': d.department,
                'exam_name': d.exam_name,
                'paper_code': d.paper_code,
                'semester': d.semester,
                'exam_date': str(d.exam_date) if d.exam_date else '',
                'session': d.session,
                'start_time': d.start_time.strftime('%H:%M:%S') if d.start_time else None,
                'end_time': d.end_time.strftime('%H:%M:%S') if d.end_time else None
            })

        return JsonResponse({'status': 'success', 'count': qs.count(), 'rows': rows})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)
