from django.db import models

# =========================
# Upload Student Data (DB only, NO file storage)
# =========================
class StudentDataFile(models.Model):
    # store filename ONLY (not the actual file)
    file_name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.file_name}"


# =========================
# Student Model (same as before)
# =========================
class Student(models.Model):
    student_file = models.ForeignKey(
        StudentDataFile,
        on_delete=models.CASCADE,
        related_name="students"
    )
    name = models.CharField(max_length=100)
    roll_number = models.CharField(max_length=50)
    registration_number = models.CharField(max_length=50)
    student_id = models.CharField(max_length=50)
    course = models.CharField(max_length=50)
    semester = models.CharField(max_length=10)
    branch = models.CharField(max_length=50)
    academic_status = models.CharField(max_length=50)

    def __str__(self):
        return f"{self.name} ({self.roll_number})"

    class Meta:
        # Ensure uniqueness only within the scope of a single upload file.
        # This prevents errors when the same student appears in different files.
        unique_together = ('student_file', 'roll_number', 'registration_number', 'student_id')


# =========================
# Exam Model
# =========================
class Exam(models.Model):
    name = models.CharField(max_length=255)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_completed = models.BooleanField(default=False)  # True when Complete Setup clicked
    is_temporary = models.BooleanField(default=True)   # True until Complete Setup

    def __str__(self):
        return self.name


# =========================
# Department-wise Exam Papers
# =========================
class DepartmentExam(models.Model):
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name="departments"
    )
    department = models.CharField(max_length=50)

    exam_name = models.CharField(max_length=255)
    paper_code = models.CharField(max_length=50)
    exam_date = models.DateField()
    session = models.CharField(max_length=20)
    start_time = models.TimeField(null=True, blank=True)  # Exam start time
    end_time = models.TimeField(null=True, blank=True)    # Exam end time

    def __str__(self):
        return f"{self.department} - {self.exam_name}"


# =========================
# Room Model
# =========================
class Room(models.Model):
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='rooms'
    )
    building = models.CharField(max_length=100)
    room_number = models.CharField(max_length=50)
    capacity = models.PositiveIntegerField()

    def __str__(self):
        return f"{self.building} - {self.room_number} ({self.capacity})"


# =========================
# Merged Student Data for Exam
# =========================
class ExamStudent(models.Model):
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='exam_students'
    )
    student_file = models.ForeignKey(
        StudentDataFile,
        on_delete=models.CASCADE,
        related_name='exam_allocations'
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='exam_allocations'
    )
    added_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.student.name} - {self.exam.name}"

    class Meta:
        unique_together = ('exam', 'student')


# =========================
# Seat Allocation Model - For storing seat data
# =========================
class SeatAllocation(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='allocations')
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='allocations')
    registration_number = models.CharField(max_length=50)
    department = models.CharField(max_length=50)
    seat_code = models.CharField(max_length=10)  # A1, B2, etc
    row = models.CharField(max_length=1)  # A-H
    column = models.IntegerField()  # 1-5
    exam_date = models.DateField(null=True, blank=True)
    exam_session = models.CharField(max_length=50, default='First Half')
    exam_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('exam', 'room', 'registration_number')

    def __str__(self):
        return f"{self.registration_number} - {self.seat_code}"


# =========================
# Attendance Sheet Records
# =========================
class AttendanceSheet(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='attendance_sheets')
    student_file = models.ForeignKey(StudentDataFile, on_delete=models.CASCADE, related_name='attendance_sheets')
    generated_at = models.DateTimeField(auto_now_add=True)
    sheet_data = models.JSONField()

    def __str__(self):
        return f"AttendanceSheet exam={self.exam.name} file={self.student_file.file_name} at {self.generated_at}"


# =========================
# Admin / Security Models
# =========================
class AdminAccount(models.Model):
    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField(max_length=254, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.username


class EligibleAdminEmail(models.Model):
    email = models.EmailField(max_length=254, unique=True)
    added_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.email


class BlockedAdminEmail(models.Model):
    email = models.EmailField(max_length=254, unique=True)
    reason = models.CharField(max_length=255, null=True, blank=True)
    blocked_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.email} (blocked)"


class PasswordResetToken(models.Model):
    email = models.EmailField(max_length=254)
    token = models.CharField(max_length=64, unique=True)
    username = models.CharField(max_length=255, blank=True)  # Auto-generated username
    temp_password = models.CharField(max_length=255, blank=True)  # Temporary password
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()  # Token expiration time
    used = models.BooleanField(default=False)

    def __str__(self):
        return f"Reset token for {self.email}"