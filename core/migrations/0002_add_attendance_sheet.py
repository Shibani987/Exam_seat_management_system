# Generated manually to add AttendanceSheet model
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='AttendanceSheet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('generated_at', models.DateTimeField(auto_now_add=True)),
                ('sheet_data', models.JSONField()),
                ('exam', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attendance_sheets', to='core.exam')),
                ('student_file', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attendance_sheets', to='core.studentdatafile')),
            ],
        ),
    ]
