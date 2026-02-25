from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.contrib.auth.decorators import login_required
from datetime import datetime, timedelta, date, time
from django.utils import timezone
from django.core.mail import send_mail
from django.conf import settings
import secrets
import string
import logging
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.shortcuts import render, redirect

import pandas as pd
import json
from django.contrib.auth.hashers import make_password, check_password
import traceback
from pathlib import Path

# Setup logging for security events
logger = logging.getLogger('exam_system')

from .forms import StudentDataUploadForm, ForgotPasswordForm, ResetPasswordForm, AdminEmailUploadForm
from .models import (
    StudentDataFile,
    Student,
    DepartmentExam,
    Exam,
    Room,
    ExamStudent,
    SeatAllocation,
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


def _get_client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')





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
        form = StudentDataUploadForm(request.POST, request.FILES)
        if not form.is_valid():
            messages.error(request, "Invalid form submission")
            return redirect("dashboard")

        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            messages.error(request, "No file uploaded")
            return redirect("dashboard")

        # Validate file size (max 10MB)
        max_size = 10 * 1024 * 1024  # 10MB
        if uploaded_file.size > max_size:
            messages.error(request, "File size too large. Maximum allowed is 10MB.")
            return redirect("dashboard")

        # Read file directly from memory (NOT disk)
        try:
            print(f"[DEBUG] Reading file: {uploaded_file.name}")
            if uploaded_file.name.endswith(".csv"):
                print(f"[DEBUG] Parsing as CSV")
                df = pd.read_csv(uploaded_file)
            else:
                print(f"[DEBUG] Parsing as Excel (.xlsx/.xls)")
                df = pd.read_excel(uploaded_file)
            print(f"[DEBUG] File read successfully, shape: {df.shape}")
        except Exception as e:
            err = traceback.format_exc()
            print(f"[ERROR] Error reading file: {e}\n{err}")
            messages.error(request, f"Error reading file: {e}")
            return redirect("dashboard")

        # Normalize column names
        df.columns = [c.strip().lower() for c in df.columns]
        print(f"[DEBUG] File columns: {list(df.columns)}")
        print(f"[DEBUG] File shape: {df.shape}")
        print(f"[DEBUG] Total rows to process: {len(df)}")
        if df.empty:
            print(f"[ERROR] File is empty after parsing")
            messages.error(request, "File is empty. Please check your file.")
            return redirect("dashboard")

        # Check if required columns exist
        available_cols = set(df.columns)
        print(f"[DEBUG] Checking for required columns. Available: {available_cols}")
        has_roll = any(col in available_cols for col in ['rollno', 'roll_no', 'roll number', 'roll no'])
        has_reg = any(col in available_cols for col in ['reg no', 'registration number', 'reg_no'])
        has_std_id = any(col in available_cols for col in ['std id', 'student id', 'student_id'])
        if not (has_roll and has_reg and has_std_id):
            print(f"[ERROR] Missing required columns. has_roll={has_roll}, has_reg={has_reg}, has_std_id={has_std_id}")
            messages.error(request, "File missing required columns: ROLL NO, REG NO, STD ID")
            return redirect("dashboard")

        # Save metadata + filename ONLY (after basic validation)
        student_file_obj = StudentDataFile.objects.create(file_name=uploaded_file.name)
        print(f"[DEBUG] Created StudentDataFile record with ID: {student_file_obj.id}")

        col_map = {
            "course": ["course"],
            "semester": ["sem", "semester"],
            "branch": ["branch"],
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

        # Save students with duplicate detection
        students = []
        duplicates = 0
        seen = set()  # Track combinations in this upload
        row_count = 0
        skipped_empty = 0
        skipped_existing = 0

        for _, row in df.iterrows():
            row_count += 1
            roll = get_value(row, col_map["roll_number"])
            reg = get_value(row, col_map["registration_number"])
            std_id = get_value(row, col_map["student_id"])

            # Skip if required fields are empty
            if not roll or not reg or not std_id:
                skipped_empty += 1
                if skipped_empty <= 3:  # Print first 3 skipped rows
                    print(f"[DEBUG] Row {row_count} skipped - empty fields: roll={roll}, reg={reg}, std_id={std_id}")
                continue

            combo = (roll, reg, std_id)

            # Check if this combination already exists in DB or in current upload
            if combo in seen:
                skipped_existing += 1
                print(f"[DEBUG] Row {row_count} skipped - duplicate in this file: {combo}")
                duplicates += 1
                continue

            if Student.objects.filter(
                roll_number=roll,
                registration_number=reg,
                student_id=std_id
            ).exists():
                skipped_existing += 1
                print(f"[DEBUG] Row {row_count} skipped - already exists in DB: {combo}")
                duplicates += 1
                continue

            seen.add(combo)

            students.append(Student(
                student_file=student_file_obj,
                course=get_value(row, col_map["course"]),
                semester=get_value(row, col_map["semester"]),
                branch=get_value(row, col_map["branch"]),
                name=get_value(row, col_map["name"]),
                roll_number=roll,
                registration_number=reg,
                student_id=std_id,
                academic_status=get_value(row, col_map["academic_status"])
            ))

        print(f"[DEBUG] Processing complete. Total rows: {row_count}, Students to save: {len(students)}, Duplicates: {duplicates}, Empty fields: {skipped_empty}, Existing in DB: {skipped_existing}")

        try:
            if len(students) > 0:
                Student.objects.bulk_create(students)
                print(f"[DEBUG] Successfully saved {len(students)} students to database")
            else:
                print(f"[DEBUG] No students to save. duplicates={duplicates}")
        except Exception as e:
            print(f"[ERROR] Error saving students: {str(e)}")
            messages.error(request, f"Error saving students to database: {e}")
            return redirect("dashboard")

        # Show appropriate message
        if len(students) == 0 and duplicates > 0:
            messages.warning(request, f"No new students added. All {row_count} rows were duplicates or invalid.")
        elif len(students) == 0:
            messages.warning(request, f"No students found in file. Please check your file format and data.")
        elif duplicates > 0:
            messages.warning(request, f"Student data uploaded! ({len(students)} added, {duplicates} duplicates/invalid skipped)")
        else:
            messages.success(request, f"Student data uploaded successfully! ({len(students)} students added)")

        print(f"[DEBUG] Final upload summary - Added: {len(students)}, Duplicates: {duplicates}")
        return redirect("dashboard")




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
            'id', 'name', 'roll_number', 'registration_number', 'student_id', 'course', 'semester', 'branch', 'academic_status'
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
    """Update multiple students. POST JSON: { students: [ {id, name, roll_number, registration_number, student_id, course, semester, branch, academic_status}, ... ] }"""
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
                for field in ['name', 'roll_number', 'registration_number', 'student_id', 'course', 'semester', 'branch', 'academic_status']:
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
    """Add new students to a StudentDataFile. POST JSON: { file_id: int, students: [ {name, roll_number, registration_number, student_id, course, semester, branch, academic_status}, ... ] }"""
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
            
            # Get dashboard URL from settings
            dashboard_url = settings.ADMIN_DASHBOARD_URL
            
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
# Delete Temporary Exam (On page unload/refresh)
# =========================
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
                            end_time=ex.get("end_time") or None
                        )
                        print(f"[DEBUG]   ✓ Exam {idx+1}: dept='{de.department}', date={de.exam_date}, session={de.session}, time={de.start_time}-{de.end_time}")
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

        # All exam students for the room's exam
        exam_students_qs = ExamStudent.objects.filter(exam=room.exam).select_related('student')
        exam_students = []
        for es in exam_students_qs:
            exam_students.append({
                'id': es.student.id,
                'registration_number': es.student.registration_number,
                'name': es.student.name,
                'department': es.student.department
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
                files_data.append({
                    'id': file_obj.id,
                    'year': int(file_obj.year),
                    'semester': int(file_obj.semester),
                    'department': file_obj.department,
                    'file_name': file_obj.file_name
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
# Save Selected Files for Exam (API)
# =========================
@admin_required_json
def save_selected_files(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            exam_id = data.get('exam_id')
            selected_files = data.get('selected_files', [])

            exam = Exam.objects.get(id=exam_id)
            
            # Extract file IDs from selected files
            file_ids = [f['id'] for f in selected_files]
            
            # Fetch all StudentDataFile records
            student_files = StudentDataFile.objects.filter(id__in=file_ids)
            
            # Fetch all Student records from these files
            students = Student.objects.filter(student_file__in=student_files)
            
            print(f"\n[DEBUG save_selected_files] Exam: {exam_id}")
            print(f"[DEBUG] Selected files: {list(student_files.values_list('id', 'department'))}")
            print(f"[DEBUG] Total students from selected files: {students.count()}")
            print(f"[DEBUG] Student departments: {list(set(students.values_list('department', flat=True)))}")
            
            # Delete previous allocations for this exam (if any)
            ExamStudent.objects.filter(exam=exam).delete()
            
            # Merge: Create ExamStudent records by merging StudentDataFile + Student data
            exam_student_records = []
            for student in students:
                exam_student = ExamStudent(
                    exam=exam,
                    student_file=student.student_file,
                    student=student
                )
                exam_student_records.append(exam_student)
            
            # Bulk create for efficiency
            ExamStudent.objects.bulk_create(exam_student_records)
            
            print(f"[DEBUG] Created {len(exam_student_records)} ExamStudent records")
            
            # Check what DepartmentExam records exist for this exam
            dept_exams_query = DepartmentExam.objects.filter(exam=exam).values_list('department', flat=True).distinct()
            print(f"[DEBUG] DepartmentExam departments for this exam: {list(dept_exams_query)}")
            
            # Prepare response
            files_data = []
            for file_obj in student_files:
                file_students = Student.objects.filter(student_file=file_obj)
                files_data.append({
                    'file_id': file_obj.id,
                    'year': file_obj.year,
                    'semester': file_obj.semester,
                    'department': file_obj.department,
                    'file_name': file_obj.file_name,
                    'student_count': file_students.count()
                })
            
            return JsonResponse({
                "status": "success",
                "message": f"Files and {students.count()} students merged and saved successfully",
                "files": files_data,
                "total_students": students.count()
            })
        except Exam.DoesNotExist:
            return JsonResponse({
                "status": "error",
                "message": "Exam not found"
            }, status=400)
        except Exception as e:
            return JsonResponse({
                "status": "error",
                "message": str(e)
            }, status=400)


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
        data = json.loads(request.body)
        exam_id = data.get('exam_id')
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
        
        exam_students = ExamStudent.objects.filter(exam=exam).select_related('student')
        dept_exams = DepartmentExam.objects.filter(exam=exam)
        rooms = list(Room.objects.filter(exam=exam).order_by('id'))
        
        print(f"\n[DEBUG generate_seating] Exam: {exam_id}")
        print(f"[DEBUG] Total exam students: {exam_students.count()}")
        print(f"[DEBUG] Student departments: {list(set(s.student.department for s in exam_students))}")
        print(f"[DEBUG] Total rooms: {len(rooms)}")
        print(f"[DEBUG] DepartmentExam records: {dept_exams.count()}")
        
        if not exam_students.exists():
            return JsonResponse({"status": "error", "message": "No students found"}, status=400)
        if not rooms:
            return JsonResponse({"status": "error", "message": "No rooms configured"}, status=400)
        
        # CHECK: If no DepartmentExam records, that's the problem!
        if not dept_exams.exists():
            student_depts = list(set(s.student.department for s in exam_students))
            print(f"\n[DEBUG] ⚠ CRITICAL: NO DepartmentExam records for this exam!")
            print(f"[DEBUG] Students have departments: {student_depts}")
            print(f"[DEBUG] Please go back to Step 2 and ADD departments & exams for: {', '.join(student_depts)}")
            return JsonResponse({
                "status": "error", 
                "message": f"NO DEPARTMENTS CONFIGURED! Please go back to Step 2 and add departments & exams.\nYour students are in: {', '.join(student_depts)}"
            }, status=400)
        
        # Build dept_exam_map
        dept_exam_map = {}
        for de in dept_exams:
            if de.department not in dept_exam_map:
                dept_exam_map[de.department] = []
            dept_exam_map[de.department].append({
                'date': de.exam_date, 
                'session': de.session, 
                'name': de.exam_name,
                'start_time': str(de.start_time) if de.start_time else None,
                'end_time': str(de.end_time) if de.end_time else None
            })
        
        print(f"[DEBUG] DepartmentExam map departments: {list(dept_exam_map.keys())}")
        
        # Group students by (year, semester, exam_date, session)
        # Students can take MULTIPLE exams (different dates)
        room_groups = defaultdict(list)
        skipped_students = []
        
        for exam_student in exam_students:
            student = exam_student.student
            year, semester, dept = student.year, student.semester, student.department
            
            if dept not in dept_exam_map:
                skipped_students.append((student.registration_number, dept))
                print(f"[DEBUG] SKIPPED student {student.registration_number} with dept='{dept}' (not in dept_exam_map)")
                continue
            
            # Add student to ALL matching exam groups
            for dept_exam_info in dept_exam_map[dept]:
                exam_date, session = dept_exam_info['date'], dept_exam_info['session']
                exam_name = dept_exam_info['name']
                start_time = dept_exam_info.get('start_time')
                end_time = dept_exam_info.get('end_time')
                group_key = (year, semester, exam_date, session)
                
                # Create a wrapper to avoid attribute conflicts
                student_wrapper = type('StudentWrapper', (), {
                    'id': exam_student.id,
                    'registration_number': student.registration_number,
                    'department': dept,
                    'exam_date': exam_date,
                    'exam_name': exam_name,
                    'session': session,
                    'start_time': start_time,
                    'end_time': end_time,
                    'student': student
                })()
                
                # Check if this student is already in this group (avoid duplicates)
                if not any(sw.id == exam_student.id for sw in room_groups[group_key]):
                    room_groups[group_key].append(student_wrapper)
        
        # Assign rooms
        room_assignment, rooms_idx = {}, 0
        for group_key in sorted(room_groups.keys(), key=lambda k: (k[0], k[1], str(k[2]), k[3])):
            students_in_group = room_groups[group_key]
            temp_dept_groups = defaultdict(list)
            
            for exam_student in students_in_group:
                temp_dept_groups[exam_student.department].append(exam_student)
            
            total_cols = sum(math.ceil(len(s) / 8) for s in temp_dept_groups.values())
            # If the group has only one department, each room will only use odd columns (1,3,5) — 3 usable cols per room
            if len(temp_dept_groups) == 1:
                rooms_needed = math.ceil(total_cols / 3) if total_cols > 3 else 1
            else:
                rooms_needed = math.ceil(total_cols / 5) if total_cols > 5 else 1
            
            assigned_rooms = []
            for _ in range(rooms_needed):
                if rooms_idx >= len(rooms):
                    # Calculate how many more rooms are needed
                    total_rooms_needed = rooms_idx + (rooms_needed - len(assigned_rooms))
                    additional_rooms = total_rooms_needed - len(rooms)
                    
                    # Get total student count for this group
                    total_students_in_group = len(students_in_group)
                    
                    return JsonResponse({
                        "status": "error", 
                        "message": f"NOT ENOUGH ROOMS! You have {len(rooms)} rooms but need {total_rooms_needed} rooms to accommodate {total_students_in_group} students. Please add {additional_rooms} more room(s) in Step 3 and try again."
                    }, status=400)
                assigned_rooms.append(rooms[rooms_idx])
                rooms_idx += 1
            
            room_assignment[group_key] = assigned_rooms
        
        # Allocate seats
        rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
        seating_results = defaultdict(list)
        
        for group_key, students_in_group in room_groups.items():
            dept_groups = defaultdict(list)
            for exam_student in students_in_group:
                dept_groups[exam_student.student.department].append(exam_student)
            
            sorted_depts = sorted(dept_groups.keys())
            # Randomize department order to avoid seating adjacency issues
            random.shuffle(sorted_depts)
            
            # Round-robin column assignment (prevents adjacent departments)
            # Dept0 -> Col1, Col4, Col8...
            # Dept1 -> Col2, Col5, Col9...
            # Dept2 -> Col3, Col6, Col10...
            assigned_rooms = room_assignment[group_key]
            num_depts = len(sorted_depts)
            
            # Compute rows per room from capacity: rows_per_room = ceil(capacity / 5)
            rows_per_room_list = [max(1, math.ceil(int(r.capacity) / 5)) for r in assigned_rooms]
            min_rows_per_room = min(rows_per_room_list) if rows_per_room_list else 8
            max_rows_per_room = max(rows_per_room_list) if rows_per_room_list else 8
            # Generate row letters dynamically based on the maximum rows needed for any room in this group
            rows_letters = [chr(ord('A') + i) for i in range(max_rows_per_room)]
            
            dept_col_assignment = {}  # {dept: [(room_idx, col), ...]}
            
            for dept_idx, dept in enumerate(sorted_depts):
                # Estimate columns needed using the smallest row count available to be safe
                cols_needed = math.ceil(len(dept_groups[dept]) / min_rows_per_room) if min_rows_per_room > 0 else math.ceil(len(dept_groups[dept]) / 8)
                dept_cols = []

                # Honor room-specific mapping first (if provided), then global mapping
                if room_col_map_norm:
                    for room_idx, room in enumerate(assigned_rooms):
                        mapping = room_col_map_norm.get(room.id) or {}
                        for col_idx in range(1, 6):
                            mapped_dept = mapping.get(col_idx)
                            if mapped_dept and mapped_dept == dept:
                                dept_cols.append((room_idx, col_idx))

                if not dept_cols and col_map_norm:
                    for room_idx, room in enumerate(assigned_rooms):
                        for col_idx in range(1, 6):
                            mapped_dept = col_map_norm.get(col_idx)
                            if mapped_dept and mapped_dept == dept:
                                dept_cols.append((room_idx, col_idx))

                # If not enough pattern columns, fall back to algorithmic assignment
                # (but NOT for single-dept rooms where user explicitly configured columns)
                user_configured_for_dept = any(
                    room.id in room_col_map_norm and dept in room_col_map_norm[room.id].values()
                    for room in assigned_rooms
                )
                if len(dept_cols) < cols_needed and not (num_depts == 1 and user_configured_for_dept):
                    if num_depts == 1:
                        # Single department: prefer odd columns within rooms (1,3,5) separated by empty columns
                        odd_cols = [1, 3, 5]
                        room_iter = 0
                        while len(dept_cols) < cols_needed:
                            for oc in odd_cols:
                                if len(dept_cols) >= cols_needed:
                                    break
                                if room_iter >= len(assigned_rooms):
                                    return JsonResponse({"status": "error", "message": "Not enough rooms for odd-column layout. Please add more rooms."}, status=400)
                                pair = (room_iter, oc)
                                if pair in dept_cols:
                                    continue
                                dept_cols.append(pair)
                            room_iter += 1
                    else:
                        # Standard distribution across rooms/cols
                        for col_count in range(cols_needed):
                            # Column number: dept_idx + 1 + (col_count * num_depts)
                            col_num = dept_idx + 1 + (col_count * num_depts)
                            
                            # Determine which room this column belongs to
                            room_idx = (col_num - 1) // 5
                            col_in_room = ((col_num - 1) % 5) + 1
                            
                            if room_idx >= len(assigned_rooms):
                                return JsonResponse({"status": "error", "message": "Not enough rooms!"}, status=400)
                            pair = (room_idx, col_in_room)
                            if pair in dept_cols:
                                continue
                            dept_cols.append(pair)

                dept_col_assignment[dept] = dept_cols
            
            # If any room ends up with columns assigned from only a single department, remap those columns to odd positions (1,3,5)
            from collections import defaultdict as _dd
            room_dept_map = _dd(set)
            for dept, pairs in dept_col_assignment.items():
                for (room_idx, col) in pairs:
                    room_dept_map[room_idx].add(dept)

            for room_idx, dept_set in room_dept_map.items():
                room_configured = assigned_rooms[room_idx].id in room_col_map_norm
                if len(dept_set) == 1 and not column_map_provided and not room_configured:
                    dept = next(iter(dept_set))
                    # Columns currently assigned to this dept in the room
                    room_pairs = [p for p in dept_col_assignment[dept] if p[0] == room_idx]
                    n = len(room_pairs)
                    odd_cols = [1, 3, 5]
                    if n <= len(odd_cols):
                        # Remove existing room pairs and replace with odd columns in same count/order
                        dept_col_assignment[dept] = [p for p in dept_col_assignment[dept] if p[0] != room_idx]
                        for i in range(n):
                            dept_col_assignment[dept].append((room_idx, odd_cols[i]))
                    else:
                        # If overflow, keep first 3 in this room and try to distribute the rest to following rooms' odd columns
                        dept_col_assignment[dept] = [p for p in dept_col_assignment[dept] if p[0] != room_idx]
                        for i in range(3):
                            dept_col_assignment[dept].append((room_idx, odd_cols[i]))
                        overflow = n - 3
                        next_room = room_idx + 1
                        while overflow > 0 and next_room < len(assigned_rooms):
                            take = min(overflow, 3)
                            for i in range(take):
                                dept_col_assignment[dept].append((next_room, odd_cols[i]))
                            overflow -= take
                            next_room += 1
                        if overflow > 0:
                            return JsonResponse({"status":"error","message":"Not enough rooms to redistribute columns for single-department room. Please add more rooms."}, status=400)

            # Allocate students to assigned (room, col) pairs
            for dept in sorted_depts:
                dept_students = sorted(dept_groups[dept], key=lambda es: int(es.registration_number[-3:]) if es.registration_number and len(es.registration_number) >= 3 and es.registration_number[-3:].isdigit() else 999)
                
                for room_idx, col in dept_col_assignment[dept]:
                    room = assigned_rooms[room_idx]
                    # Rows for this room depend on its capacity (columns are fixed at 5)
                    rows_for_room = max(1, math.ceil(int(room.capacity) / 5))
                    for row_idx in range(min(rows_for_room, len(dept_students))):
                        if not dept_students:
                            break
                        es = dept_students.pop(0)
                        # Use dynamically generated letters (A, B, C, ...). Fall back to A.. if needed.
                        row_letter = rows_letters[row_idx] if row_idx < len(rows_letters) else chr(ord('A') + row_idx)
                        seating_results[room.id].append({
                            'registration': es.registration_number,
                            'department': dept,
                            'seat': f"{row_letter}{col}",
                            'row': row_letter,
                            'column': col,
                            'exam_date': str(es.exam_date),
                            'session': es.session,
                            'exam_name': es.exam_name,
                            'start_time': es.start_time,
                            'end_time': es.end_time
                        })

                # Fallback: if there are remaining students in this department, fill any free seats across assigned rooms
                if dept_students:
                    for room_idx2, room2 in enumerate(assigned_rooms):
                        rows_for_room2 = max(1, math.ceil(int(room2.capacity) / 5))
                        for row_idx2 in range(rows_for_room2):
                            row_letter2 = rows_letters[row_idx2] if row_idx2 < len(rows_letters) else chr(ord('A') + row_idx2)
                            # Determine columns to iterate for this row (respect last-row partial columns)
                            cols_to_iter = range(1, 6)
                            if row_idx2 == rows_for_room2 - 1:
                                filled_before = (rows_for_room2 - 1) * 5
                                last_row_cols = max(0, int(room2.capacity) - filled_before)
                                if last_row_cols > 0:
                                    cols_to_iter = range(1, last_row_cols + 1)
                                else:
                                    cols_to_iter = []

                            for col2 in cols_to_iter:
                                # Skip seats already assigned
                                existing = any(s['row'] == row_letter2 and s['column'] == col2 for s in seating_results[room2.id])
                                if existing:
                                    continue
                                if not dept_students:
                                    break
                                es = dept_students.pop(0)
                                seating_results[room2.id].append({
                                    'registration': es.registration_number,
                                    'department': dept,
                                    'seat': f"{row_letter2}{col2}",
                                    'row': row_letter2,
                                    'column': col2,
                                    'exam_date': str(es.exam_date),
                                    'session': es.session,
                                    'exam_name': es.exam_name,
                                    'start_time': es.start_time,
                                    'end_time': es.end_time
                                })
                            if not dept_students:
                                break
                        if not dept_students:
                            break

                    if dept_students:
                        # Not enough seats within assigned rooms — return a useful error
                        return JsonResponse({"status": "error", "message": f"Not enough seats to allocate all students in department {dept}. {len(dept_students)} students remain. Please add more rooms or adjust capacities."}, status=400)
        
        response_rooms = []
        print(f"[DEBUG] Building response_rooms from {len(rooms)} rooms")
        print(f"[DEBUG] seating_results keys (room IDs with seats): {list(seating_results.keys())}")
        
        for room in rooms:
            print(f"[DEBUG] Checking room {room.id} (Building: {room.building}, Room: {room.room_number})")
            if room.id in seating_results:
                seats = seating_results[room.id]
                print(f"[DEBUG]   ✓ Found {len(seats)} seats for this room")
                response_rooms.append({
                    'id': room.id,
                    'building': room.building,
                    'room_number': room.room_number,
                    'capacity': room.capacity,
                    'departments': list(set(s['department'] for s in seats)),
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
            student_depts_in_file = list(set(s.student.department for s in exam_students))
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
        for room in response_rooms:
            for seat in room['seats']:
                # Extract row and column from seat data
                row = seat.get('row', 'A')
                column = seat.get('column', 1)
                
                print(f"[DEBUG] Creating SeatAllocation: reg={seat['registration']}, row={row}, column={column}, seat_code={seat['seat']}")
                
                sa = SeatAllocation(
                    exam=exam,
                    room_id=room['id'],
                    registration_number=seat['registration'],
                    department=seat['department'],
                    seat_code=seat['seat'],
                    row=row,
                    column=column,
                    exam_date=seat['exam_date'],
                    exam_session=seat['session'],
                    exam_name=seat['exam_name']
                )
                seat_allocations.append(sa)
        
        SeatAllocation.objects.bulk_create(seat_allocations)
        print(f"[DEBUG] Saved {len(seat_allocations)} seat allocations to database")
        
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
def get_exam_summary(request):
    """Fetch complete exam summary for Step 6 verification"""
    try:
        exam_id = request.GET.get('exam_id')
        if not exam_id:
            return JsonResponse({"status": "error", "message": "exam_id required"}, status=400)
        
        exam = Exam.objects.get(id=exam_id)
        
        # 1. Exam details
        exam_data = {
            "id": exam.id,
            "name": exam.name or "",
            "start_date": str(exam.start_date) if exam.start_date else "",
            "end_date": str(exam.end_date) if exam.end_date else ""
        }
        
        # 2. Departments & Exams
        departments = exam.departments.all().values(
            'department', 'exam_name', 'paper_code', 'exam_date', 'session', 'start_time', 'end_time'
        )
        departments_data = list(departments)
        
        # 3. Rooms
        rooms = exam.rooms.all().values('id', 'building', 'room_number', 'capacity')
        rooms_data = list(rooms)
        
        # 4. Student Files used
        student_files = StudentDataFile.objects.filter(
            students__exam_allocations__exam=exam
        ).distinct().values('id', 'file_name', 'year', 'semester', 'department')
        
        student_files_data = []
        for file in student_files:
            student_count = Student.objects.filter(
                student_file_id=file['id'],
                exam_allocations__exam=exam
            ).distinct().count()
            file_dict = dict(file)
            file_dict['student_count'] = student_count
            student_files_data.append(file_dict)
        
        # 5. Seating arrangement with student semester/year
        seating = SeatAllocation.objects.filter(exam=exam).select_related('exam').values(
            'registration_number', 'department', 'seat_code', 
            'room__building', 'room__room_number',
            'exam_date', 'exam_session', 'exam_name'
        )
        seating_data = []
        for seat in seating:
            # Get student data for semester and year
            try:
                student = Student.objects.get(registration_number=seat['registration_number'])
                semester = student.semester or ""
                year = student.year or ""
            except Student.DoesNotExist:
                semester = ""
                year = ""
            
            seating_data.append({
                'registration_number': seat['registration_number'],
                'department': seat['department'],
                'seat_code': seat['seat_code'],
                'room_building': seat['room__building'],
                'room_number': seat['room__room_number'],
                'exam_date': str(seat['exam_date']) if seat['exam_date'] else "",
                'exam_session': seat['exam_session'] or "First Half",
                'exam_name': seat['exam_name'] or "",
                'semester': semester,
                'year': year
            })
        
        total_students = ExamStudent.objects.filter(exam=exam).count()
        total_seats = SeatAllocation.objects.filter(exam=exam).count()
        
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
    
    except Exam.DoesNotExist:
        return JsonResponse({"status": "error", "message": "Exam not found"}, status=404)
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


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
                'exam_date': str(d.exam_date) if d.exam_date else '',
                'session': d.session,
                'start_time': d.start_time.strftime('%H:%M:%S') if d.start_time else None,
                'end_time': d.end_time.strftime('%H:%M:%S') if d.end_time else None
            })

        return JsonResponse({'status': 'success', 'count': qs.count(), 'rows': rows})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=400)


