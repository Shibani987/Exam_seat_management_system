from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_departmentexam_room_number'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='seatallocation',
            unique_together={('exam', 'room', 'exam_date', 'exam_session', 'seat_code')},
        ),
    ]
