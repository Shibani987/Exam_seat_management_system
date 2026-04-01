// Attendance Wizard Logic

function getCsrfToken() {
  const name = 'csrftoken';
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

const examNameInput = document.getElementById('examName');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const generateBtn = document.getElementById('generateBtn');
const filesTableBody = document.getElementById('filesTableBody');
const wizardFileInput = document.getElementById('wizardFileInput');
const uploadWizardFileBtn = document.getElementById('uploadWizardFileBtn');
const wizardUploadStatus = document.getElementById('wizardUploadStatus');

let currentExamId = null;
let generatedSheets = [];
let tempUploadedFile = null;

window.addEventListener('DOMContentLoaded', () => {
  fetch('/init-temp-exam/?t=' + Date.now())
    .then(r => r.json())
    .then(d => {
      if (d.status === 'success') {
        currentExamId = d.exam_id;
      } else {
        alert('Error initializing temporary exam. Please reload.');
        console.error('init_temp_exam error', d);
      }
    })
    .catch(err => {
      console.error('init_temp_exam fetch failed', err);
      alert('Error initializing temporary exam. Please reload.');
    });
});

examNameInput.addEventListener('input', () => {
  nextBtn.disabled = examNameInput.value.trim().length === 0;
});

nextBtn.addEventListener('click', () => {
  const name = examNameInput.value.trim();
  if (!currentExamId) {
    alert('Temporary exam ID missing, please reload the page.');
    return;
  }

  fetch('/update-temp-exam/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken()
    },
    body: JSON.stringify({ exam_id: currentExamId, name })
  })
    .then(r => r.json())
    .then(d => {
      if (d.status !== 'success') {
        console.error('Name update failed', d);
      }
      document.getElementById('step1Content').style.display = 'none';
      document.getElementById('step2Content').style.display = 'block';
      document.getElementById('stepIndicator1').classList.remove('active');
      document.getElementById('stepIndicator2').classList.add('active');
    });
});

backBtn.addEventListener('click', () => {
  document.getElementById('step2Content').style.display = 'none';
  document.getElementById('step1Content').style.display = 'block';
  document.getElementById('stepIndicator2').classList.remove('active');
  document.getElementById('stepIndicator1').classList.add('active');
});

if (wizardFileInput) {
  wizardFileInput.addEventListener('change', () => {
    if (wizardUploadStatus) {
      wizardUploadStatus.textContent = '';
      wizardUploadStatus.className = 'wizard-upload-status';
    }
  });
}

if (uploadWizardFileBtn) {
  uploadWizardFileBtn.addEventListener('click', async () => {
    if (!currentExamId) {
      alert('Temporary exam missing. Please reload the page.');
      return;
    }
    if (!wizardFileInput || !wizardFileInput.files || wizardFileInput.files.length === 0) {
      setUploadStatus('Please choose an Excel or CSV file first.', true);
      return;
    }

    const formData = new FormData();
    formData.append('exam_id', currentExamId);
    formData.append('file', wizardFileInput.files[0]);

    uploadWizardFileBtn.disabled = true;
    setUploadStatus('Uploading and checking file...', false);

    try {
      const response = await fetch('/upload-attendance-wizard-file/', {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCsrfToken()
        },
        body: formData
      });
      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        setUploadStatus(data.message || 'Upload failed.', true);
        return;
      }

      tempUploadedFile = data.file;
      renderTempFileTable();

      const summary = `Uploaded ${data.file.file_name} with ${data.file.student_count} student rows.`;
      if (data.file.skipped > 0) {
        setUploadStatus(`${summary} ${data.file.skipped} row(s) were skipped.`, false);
      } else {
        setUploadStatus(summary, false);
      }
      generateBtn.disabled = false;
    } catch (error) {
      console.error('wizard upload failed', error);
      setUploadStatus('Upload failed. Please try again.', true);
    } finally {
      uploadWizardFileBtn.disabled = false;
    }
  });
}

function setUploadStatus(message, isError) {
  if (!wizardUploadStatus) return;
  wizardUploadStatus.textContent = message;
  wizardUploadStatus.className = isError ? 'wizard-upload-status error' : 'wizard-upload-status success';
}

function renderTempFileTable() {
  if (!tempUploadedFile) {
    filesTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 30px; color: #999;">No temporary file uploaded yet.</td></tr>';
    generateBtn.disabled = true;
    return;
  }

  filesTableBody.innerHTML = `
    <tr>
      <td>${tempUploadedFile.file_name}</td>
      <td>${tempUploadedFile.uploaded_at || '-'}</td>
      <td>${tempUploadedFile.student_count || 0}</td>
    </tr>
  `;
}

generateBtn.addEventListener('click', () => {
  if (!currentExamId) {
    alert('Temporary exam missing');
    return;
  }
  if (!tempUploadedFile) {
    alert('Please upload a student data file first.');
    return;
  }

  fetch('/generate-sheets/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken()
    },
    body: JSON.stringify({ exam_id: currentExamId })
  })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        generatedSheets = data.sheets;
        showStep3(data.sheets, data.exam_name);
      } else {
        alert('Error generating sheets: ' + data.message);
      }
    });
});

function showStep3(pages, examName) {
  const step2Elem = document.getElementById('step2Content');
  const step3Elem = document.getElementById('step3Content');
  if (step2Elem && step3Elem) {
    step2Elem.style.display = 'none';
    step3Elem.style.display = 'block';
    document.getElementById('stepIndicator2').classList.remove('active');
    document.getElementById('stepIndicator3').classList.add('active');
  }
  const container = document.getElementById('sheetsPreview');
  if (!container) return;
  container.innerHTML = '';

  generatedSheets = pages;

  if (!document.getElementById('attendance-sheet-css')) {
    const link = document.createElement('link');
    link.id = 'attendance-sheet-css';
    link.rel = 'stylesheet';
    link.href = '/static/core/css/attendance_sheet_print.css';
    document.head.appendChild(link);
  }

  if (!document.getElementById('attendance-sheet-layout-fix')) {
    const style = document.createElement('style');
    style.id = 'attendance-sheet-layout-fix';
    style.textContent = `
      .sheet-footer-row-primary {
        margin-top: 10px;
      }
      .sheet-footer-row-secondary {
        margin-top: 40px;
      }
      .sheet-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 0;
      }
      @media print {
        .attendance-sheet {
          padding-bottom: 2px !important;
          min-height: calc(100vh - 2px) !important;
        }
        .sheet-header {
          min-height: 88px !important;
        }
        .sheet-title {
          margin: 1px 0 4px 0 !important;
        }
        .sheet-meta-box {
          margin: 0 0 6px 0 !important;
          padding: 4px 0 !important;
        }
        .sheet-table {
          margin-bottom: 0 !important;
        }
        .sheet-table tbody tr,
        .sheet-table td {
          height: 33px !important;
          line-height: 33px !important;
        }
        .sheet-table th {
          height: 20px !important;
        }
        .sheet-table + .sheet-footer-row {
          margin-top: 10px !important;
          padding-top: 0 !important;
        }
        .sheet-footer-row + .sheet-footer-row {
          margin-top: 40px !important;
        }
        .footer-right-internal {
          margin-top: 2px !important;
        }
        .footer-left-hod,
        .footer-right-external {
          margin-top: 4px !important;
        }
        .sheet-footer {
          margin-top: auto !important;
          padding-top: 0 !important;
          font-size: 8px !important;
        }
        .sheet-footer-meta {
          font-size: 10px !important;
          line-height: 1 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  pages.forEach((pageMeta) => {
    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'attendance-sheet';
    let html = `
      <div class="sheet-header">
        <div class="header-logo"><img src="/static/core/img/logo.png" alt="logo" /></div>
        <div class="header-text">
          <h2>CONTROLLER OF EXAMINATIONS</h2>
          <p>JIS COLLEGE OF ENGINEERING</p>
          <p>AN AUTONOMOUS INSTITUTE UNDER MAKAUT, W.B.</p>
        </div>
      </div>
      <div class="sheet-title">
        Attendance Sheet for ${examName}
      </div>
      <div class="sheet-meta-box">
        <div class="meta-field-group">
          <div class="meta-field">Date of Examination</div>
          <div class="meta-field">Paper Name</div>
        </div>
        <div class="meta-field-group">
          <div class="meta-field">Time</div>
          <div class="meta-field">Paper Code</div>
        </div>
      </div>
      <table class="sheet-table">
        <colgroup>
          <col style="width:2%" />
          <col />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th class="sl-col">SL.</th>
            <th class="name-col">STUDENT NAME</th>
            <th class="reg-col">UNIVERSITY REG.<br>NUMBER</th>
            <th class="roll-col">COLLEGE ROLL<br>NUMBER</th>
            <th class="booklet-col">ANSWER BOOKLET<br>NUMBER</th>
            <th class="signature-col">CANDIDATE<br>SIGNATURE</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (let i = 0; i < 20; i++) {
      const student = (pageMeta.students || [])[i];
      let slText = '';
      if (student && (student.name || student.registration_number || student.roll_number)) {
        slText = `${i + 1}.`;
      }
      html += `
        <tr>
          <td class="sl-col">${slText}</td>
          <td class="name-col">${student ? (student.name || '').toUpperCase() : ''}</td>
          <td class="reg-col">${student ? (student.registration_number || '').toUpperCase() : ''}</td>
          <td class="roll-col">${student ? (student.roll_number || '').toUpperCase() : ''}</td>
          <td class="booklet-col"></td>
          <td class="signature-col"></td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
      <div class="sheet-footer-row sheet-footer-row-primary">
        <div class="footer-left">
          <div class="footer-section small">
            <div class="footer-field-row">
              <div class="footer-field">No of Student Present</div>
              <div class="footer-mini-box"></div>
            </div>
          </div>
          <div class="footer-section small">
            <div class="footer-field-row">
              <div class="footer-field">No of Student Absent</div>
              <div class="footer-mini-box"></div>
            </div>
          </div>
        </div>
        <div class="footer-right-internal">
          <div class="signature-box"></div>
          <div class="footer-label">Signature of Examiner (Internal)</div>
          <div class="name-caption">Name (in CAPITAL):</div>
        </div>
      </div>
      <div class="sheet-footer-row sheet-footer-row-secondary">
        <div class="footer-left-hod">
          <div class="hod-line"></div>
          <div class="hod-label">Signature of HoD</div>
        </div>
        <div class="footer-right-external">
          <div class="external-line"></div>
          <div class="footer-label">Signature of Examiner (External)</div>
          <div class="name-caption">Name (in CAPITAL):</div>
        </div>
      </div>
      <div class="sheet-footer">
        <div class="sheet-footer-meta sheet-footer-meta-left">
          ${pageMeta.room_number ? ('ROOM ' + pageMeta.room_number.toUpperCase()) : (pageMeta.branch ? (pageMeta.branch.toUpperCase() + '_Sem ' + (pageMeta.semester || '')) : '')}
        </div>
        <div class="sheet-footer-meta sheet-footer-meta-right">
          Page ${pageMeta.page_index} of ${pageMeta.total_pages}
        </div>
      </div>
    `;

    sheetDiv.innerHTML = html;
    container.appendChild(sheetDiv);
  });
}

const saveBtn = document.getElementById('saveBtn');
const backToStep2Btn = document.getElementById('backToStep2Btn');

if (backToStep2Btn) {
  backToStep2Btn.addEventListener('click', () => {
    document.getElementById('step3Content').style.display = 'none';
    document.getElementById('step2Content').style.display = 'block';
    document.getElementById('stepIndicator3').classList.remove('active');
    document.getElementById('stepIndicator2').classList.add('active');
    generateBtn.disabled = !tempUploadedFile;
  });
}

saveBtn.addEventListener('click', () => {
  if (!currentExamId) return;
  fetch('/save-generated-sheets/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken()
    },
    body: JSON.stringify({ exam_id: currentExamId, sheets: generatedSheets })
  })
    .then(r => r.json())
    .then(d => {
      if (d.status === 'success') {
        alert('Attendance sheets saved');
        currentExamId = null;
        window.location.href = '/';
      } else {
        alert('Save failed: ' + d.message);
      }
    })
    .catch(err => {
      console.error('Save sheets error', err);
      alert('Save failed');
    });
});

window.addEventListener('beforeunload', () => {
  if (currentExamId) {
    const payload = JSON.stringify({ exam_id: currentExamId });
    fetch('/delete-temp-exam/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }
});
