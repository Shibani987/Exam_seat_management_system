console.log('[DASHBOARD JS] Script loaded!');

// ================= SIDEBAR & MODAL HANDLERS =================
const hamburgerBtn = document.getElementById('hamburgerBtn');
const closeBtn = document.getElementById('closeBtn');
const sidebar = document.getElementById('sidebar');
const newExamBtn = document.getElementById('newExamBtn');
const newExamModal = document.getElementById('newExamModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');

// Safely check if modal exists (to avoid errors if missing in some views)
if (newExamBtn && newExamModal && modalCloseBtn) {
  // Open modal
  newExamBtn.addEventListener('click', () => {
    newExamModal.classList.add('active');
  });

  // Close modal
  modalCloseBtn.addEventListener('click', () => {
    newExamModal.classList.remove('active');
  });

  // Close modal when clicking outside modal content
  newExamModal.addEventListener('click', (event) => {
    if (event.target === newExamModal) {
      newExamModal.classList.remove('active');
    }
  });

  // Close modal with Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && newExamModal.classList.contains('active')) {
      newExamModal.classList.remove('active');
    }
  });
}

// ================= SIDEBAR TOGGLE =================
if (hamburgerBtn && sidebar && closeBtn) {
  hamburgerBtn.addEventListener('click', () => {
    hamburgerBtn.classList.toggle('active');
    sidebar.classList.toggle('active');
  });

  closeBtn.addEventListener('click', () => {
    hamburgerBtn.classList.remove('active');
    sidebar.classList.remove('active');
  });
}

// ================= TAB SWITCHING =================
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

tabLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tabId = link.getAttribute('data-tab');

    // Remove active class from all
    tabLinks.forEach(l => l.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    // Add to selected
    link.classList.add('active');
    document.getElementById(tabId).classList.add('active');

    // Close sidebar in mobile
    sidebar.classList.remove('active');
    hamburgerBtn.classList.remove('active');

    // If we just opened the generate-sheet tab, refresh its data and update URL
    if (tabId === 'generate-sheet') {
      fetchGeneratedSheets();
      // push state so back button returns here
      const u = new URL(window.location);
      u.searchParams.set('tab','generate-sheet');
      window.history.replaceState({},'',u);
    } else {
      // Clear sheets container when leaving generate-sheet tab
      const sheetsContainer = document.getElementById('sheetsContainer');
      if (sheetsContainer) {
        sheetsContainer.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">No sheets generated yet.</p>';
      }
    }
  });
});

// ================= LOGOUT CLOSE SIDEBAR =================
if (sidebar) {
  const logoutLink = sidebar.querySelector('.logout a');
  if (logoutLink) {
    logoutLink.addEventListener('click', () => {
      sidebar.classList.remove('active');
      hamburgerBtn.classList.remove('active');
    });
  }

  // ================= CLOSE SIDEBAR ON OUTSIDE CLICK (MOBILE) =================
  document.addEventListener('click', (event) => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile && sidebar.classList.contains('active')) {
      if (!sidebar.contains(event.target) && !hamburgerBtn.contains(event.target)) {
        sidebar.classList.remove('active');
        hamburgerBtn.classList.remove('active');
      }
    }
  });
}

// ================= NEW EXAM MODAL BUTTONS =================

// ================= GENERATED SHEETS API =================
function fetchGeneratedSheets() {
  // Only execute if generate-sheet tab is visible
  const generateSheetTab = document.getElementById('generate-sheet');
  if (!generateSheetTab || !generateSheetTab.classList.contains('active')) {
    console.log('[dash_board.js] fetchGeneratedSheets called but generate-sheet tab not active - aborting');
    return;
  }
  
  fetch('/get-generated-sheets/?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        const cont = document.getElementById('sheetsContainer');
        const total = document.getElementById('totalSheetsCount');
        // display number of distinct exams for which sheets exist
        const uniqueExams = new Set(data.sheets.map(s => s.exam_name));
        total.textContent = uniqueExams.size;
        if (data.sheets.length === 0) {
          cont.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">No sheets generated yet.</p>';
        } else {
          cont.innerHTML = '';
          // create styled table with actions
          const tbl = document.createElement('table');
          tbl.className = 'sheets-table';
          tbl.innerHTML = '<thead><tr><th>Exam</th><th>File</th><th>Sheets</th><th>Students</th><th>Generated At</th><th>Actions</th></tr></thead>';
          const body = document.createElement('tbody');
          data.sheets.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${s.exam_name}</td><td>${s.file_name}</td><td>${s.sheet_count}</td><td>${s.student_count}</td><td>${s.generated_at}</td>`;
            const actTd = document.createElement('td');
            // action buttons with classes
            const viewBtn = document.createElement('button'); viewBtn.textContent='View'; viewBtn.className='btn-view';
            // open in new tab to preserve dashboard state
            viewBtn.onclick = ()=>{ window.open('/generated-sheet-view/?id='+s.id, '_blank'); };
            const delBtn = document.createElement('button'); delBtn.textContent='Delete'; delBtn.className='btn-delete';
            delBtn.onclick = ()=>{
              if(!confirm('Remove sheets for this exam?')) return;
              fetch('/delete-generated-sheet/',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':getCsrfToken()},body:JSON.stringify({id:s.id})})
                .then(rr=>rr.json()).then(j=>{ if(j.status==='success') fetchGeneratedSheets(); else alert('delete failed'); });
            };
            actTd.appendChild(viewBtn); actTd.appendChild(delBtn);
            tr.appendChild(actTd);
            body.appendChild(tr);
          });
          tbl.appendChild(body);
          cont.appendChild(tbl);
        }
      }
    })
    .catch(err => console.error('Error fetching generated sheets', err));
}

// Initialize fetchGeneratedSheets when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const sheetTab = document.getElementById('generate-sheet');
    if (sheetTab && sheetTab.classList.contains('active')) {
      fetchGeneratedSheets();
      const u = new URL(window.location);
      u.searchParams.set('tab','generate-sheet');
      window.history.replaceState({},'',u);
    }
  });
} else {
  const sheetTab = document.getElementById('generate-sheet');
  if (sheetTab && sheetTab.classList.contains('active')) {
    fetchGeneratedSheets();
  }
}

// ================= NEW EXAM MODAL BUTTONS =================
const uploadBtn = document.querySelector('.btn-upload');
const continueBtn = document.querySelector('.btn-continue');

if (uploadBtn) {
  uploadBtn.addEventListener('click', () => {
    // Close modal
    newExamModal.classList.remove('active');

    // Switch tab to "Upload Student Data"
    document.querySelector('[data-tab="upload-data"]').classList.add('active');
    document.querySelector('[data-tab="create-exam"]').classList.remove('active');
    document.getElementById('upload-data').classList.add('active');
    document.getElementById('create-exam').classList.remove('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

if (continueBtn) {
  continueBtn.addEventListener('click', () => {
    window.location.href = examSetupUrl; // ✅ dynamic Django URL
  });
}

// ================= ENABLE UPLOAD BUTTON ONLY WHEN FILE SELECTED =================
const fileInput = document.getElementById("id_file");
const uploadDataBtn = document.getElementById("uploadBtn");

if (uploadDataBtn && fileInput) {
  function checkFileSelected() {
    if (fileInput.files.length > 0) {
      uploadDataBtn.disabled = false;
    } else {
      uploadDataBtn.disabled = true;
    }
  }

  fileInput.addEventListener("change", checkFileSelected);
}


// ================= GENERATE SHEET ATTENDANCE =================
const generateSheetBtn = document.getElementById('generateSheetBtn');
const uploadCheckModal = document.getElementById('uploadCheckModal');
const uploadCheckCloseBtn = document.getElementById('uploadCheckCloseBtn');
const goToUploadBtn = document.getElementById('goToUploadBtn');
const proceedToWizardBtn = document.getElementById('proceedToWizardBtn');
const uploadCheckMessage = document.getElementById('uploadCheckMessage');

if (generateSheetBtn) {
  generateSheetBtn.addEventListener('click', () => {
    // Check if student data has been uploaded
    checkStudentDataAndShowModal();
  });
}

if (uploadCheckCloseBtn) {
  uploadCheckCloseBtn.addEventListener('click', () => {
    uploadCheckModal.classList.remove('active');
  });
}


if (goToUploadBtn) {
  goToUploadBtn.addEventListener('click', () => {
    uploadCheckModal.classList.remove('active');
    // Switch to upload-data tab
    document.querySelector('[data-tab="generate-sheet"]').classList.remove('active');
    document.querySelector('[data-tab="upload-data"]').classList.add('active');
    document.getElementById('generate-sheet').classList.remove('active');
    document.getElementById('upload-data').classList.add('active');
  });
}

if (proceedToWizardBtn) {
  proceedToWizardBtn.addEventListener('click', () => {
    window.location.href = '/attendance-wizard/';
  });
}

function checkStudentDataAndShowModal() {
  // Fetch uploaded files to check if any exist
  fetch('/get_uploaded_files/?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      // always show both buttons; disable continue if no files
      goToUploadBtn.style.display = 'inline-block';
      proceedToWizardBtn.style.display = 'inline-block';

      if (data.status === 'success' && Array.isArray(data.files) && data.files.length > 0) {
        uploadCheckMessage.textContent = 'Student data has been uploaded. If you\'ve already uploaded, you can proceed by clicking Continue below.';
      } else {
        uploadCheckMessage.textContent = 'To generate an attendance sheet, uploading student data is mandatory. If you\'ve already uploaded, you can proceed by clicking Continue below.';
      }

      uploadCheckModal.classList.add('active');
    })
    .catch(err => {
      console.error('Error checking files:', err);
      uploadCheckMessage.textContent = 'Error checking student data. Please try again.';
      uploadCheckModal.classList.add('active');
    });
}

// Close modal when clicking outside
if (uploadCheckModal) {
  uploadCheckModal.addEventListener('click', (event) => {
    if (event.target === uploadCheckModal) {
      uploadCheckModal.classList.remove('active');
    }
  });
}




