from django import forms
from .models import StudentDataFile

class StudentDataUploadForm(forms.ModelForm):
    class Meta:
        model = StudentDataFile
        fields = []


class ForgotPasswordForm(forms.Form):
    email = forms.EmailField(label='Admin email')


class ResetPasswordForm(forms.Form):
    email = forms.EmailField(widget=forms.HiddenInput())
    new_password = forms.CharField(widget=forms.PasswordInput(), min_length=6)
    confirm_password = forms.CharField(widget=forms.PasswordInput(), min_length=6)

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('new_password') != cleaned.get('confirm_password'):
            raise forms.ValidationError('Passwords do not match')
        return cleaned


class AdminEmailUploadForm(forms.Form):
    file = forms.FileField(required=False)
    emails = forms.CharField(widget=forms.Textarea(attrs={'rows':5}), required=False,
                             help_text='Paste one email per line, or upload a CSV/text file with emails')

    def clean(self):
        cleaned = super().clean()
        if not cleaned.get('file') and not cleaned.get('emails'):
            raise forms.ValidationError('Provide a file or paste emails in the box')
        return cleaned


class AdminEmailForm(forms.Form):
    email = forms.EmailField(label='Admin email', widget=forms.EmailInput(attrs={'placeholder':'name@example.com'}))
