# Generated migration for Student and StudentDataFile refactor

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_alter_student_department_alter_student_semester_and_more'),
    ]

    operations = [
        # Remove old Student fields
        migrations.RemoveField(
            model_name='student',
            name='department',
        ),
        migrations.RemoveField(
            model_name='student',
            name='year',
        ),
        # Alter StudentDataFile - remove year, semester, department
        migrations.RemoveField(
            model_name='studentdatafile',
            name='year',
        ),
        migrations.RemoveField(
            model_name='studentdatafile',
            name='semester',
        ),
        migrations.RemoveField(
            model_name='studentdatafile',
            name='department',
        ),
        # Add new Student fields
        migrations.AddField(
            model_name='student',
            name='course',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name='student',
            name='semester',
            field=models.CharField(blank=True, max_length=10),
        ),
        migrations.AddField(
            model_name='student',
            name='branch',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name='student',
            name='student_id',
            field=models.CharField(default='', max_length=50),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='student',
            name='academic_status',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name='student',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
        # Update unique constraint
        migrations.AlterUniqueTogether(
            name='student',
            unique_together={('roll_number', 'registration_number', 'student_id')},
        ),
    ]
