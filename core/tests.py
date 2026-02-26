from django.test import TestCase
from django.urls import reverse
from .models import Exam, StudentDataFile, Student, AttendanceSheet
import json


class AttendanceWizardTests(TestCase):
    def setUp(self):
        # simulate admin login via session key
        session = self.client.session
        session['admin_logged_in'] = True
        session.save()

        # create a student file and some students
        self.file = StudentDataFile.objects.create(file_name='test.xlsx')
        for i in range(1, 25):
            Student.objects.create(
                student_file=self.file,
                name=f"Student {i}",
                roll_number=str(1000 + i),
                registration_number=str(2000 + i),
                student_id=str(3000 + i),
                course='BSC',
                semester='1',
                branch='Science',
                academic_status='Regular'
            )

    def test_wizard_flow(self):
        # init temp exam
        resp = self.client.get(reverse('init_temp_exam'))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'success')
        exam_id = data['exam_id']
        # deleting the temp exam should remove it
        resp2 = self.client.post(reverse('delete_temp_exam'), json.dumps({'exam_id': exam_id}), content_type='application/json')
        self.assertEqual(resp2.json()['status'], 'success')
        self.assertFalse(Exam.objects.filter(id=exam_id).exists())
        # create another temp exam to continue the flow
        resp = self.client.get(reverse('init_temp_exam'))
        data = resp.json()
        exam_id = data['exam_id']

        # update name
        resp = self.client.post(reverse('update_temp_exam'), json.dumps({'exam_id': exam_id, 'name': 'My Exam'}), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Exam.objects.get(id=exam_id).name, 'My Exam')

        # generate sheets
        resp = self.client.post(reverse('generate_sheets'), json.dumps({'exam_id': exam_id, 'file_id': self.file.id}), content_type='application/json')
        data = resp.json()
        self.assertEqual(data['status'], 'success')
        self.assertIn('sheets', data)
        # exam name should propagate
        self.assertEqual(data.get('exam_name'), 'My Exam')
        # expect at least two sheets (24 students -> 2 sheets)
        self.assertTrue(len(data['sheets']) >= 2)

        # save generated sheets
        resp = self.client.post(reverse('save_generated_sheets'), json.dumps({'exam_id': exam_id, 'file_id': self.file.id, 'sheets': data['sheets']}), content_type='application/json')
        self.assertEqual(resp.json()['status'], 'success')
        # exam should still be temporary until complete_exam_setup is called
        exam_obj = Exam.objects.get(id=exam_id)
        self.assertTrue(exam_obj.is_temporary and not exam_obj.is_completed)

        # mark complete
        resp = self.client.post(reverse('complete_exam_setup'), json.dumps({'exam_id': exam_id}), content_type='application/json')
        self.assertEqual(resp.json()['status'], 'success')
        exam_obj.refresh_from_db()
        self.assertFalse(exam_obj.is_temporary)
        self.assertTrue(exam_obj.is_completed)

        # get list of generated sheets
        resp = self.client.get(reverse('get_generated_sheets'))
        j = resp.json()
        self.assertEqual(j['status'], 'success')
        self.assertTrue(len(j['sheets']) >= 1)
        sheet_record = j['sheets'][0]
        self.assertEqual(sheet_record['exam_name'], 'My Exam')
        self.assertEqual(sheet_record['file_name'], self.file.file_name)
        self.assertEqual(sheet_record['student_count'], 24)
        self.assertEqual(sheet_record['sheet_count'], 2)
