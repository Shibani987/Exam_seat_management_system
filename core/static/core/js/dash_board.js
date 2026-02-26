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
  });
});

// ================= LOGOUT CLOSE SIDEBAR =================
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


// ================= GENERATE ATTENDANCE FLOW =================
const gaExamName = document.getElementById('ga_exam_name');
const gaNextBtn = document.getElementById('ga_next_btn');
const gaCancelBtn = document.getElementById('ga_cancel_btn');
const gaStep1 = document.getElementById('ga-step1');
const gaStep2 = document.getElementById('ga-step2');
const gaFileFilter = document.getElementById('ga_file_filter');
const gaShowAll = document.getElementById('ga_show_all');
const gaFilesList = document.getElementById('ga_files_list');
const gaLoading = document.getElementById('ga_loading');
const gaGenerateBtn = document.getElementById('ga_generate_btn');
const gaBackBtn = document.getElementById('ga_back_btn');

let gaFiles = [];

if (gaExamName && gaNextBtn) {
  gaExamName.addEventListener('input', () => {
    gaNextBtn.disabled = gaExamName.value.trim().length === 0;
  });

  gaCancelBtn && gaCancelBtn.addEventListener('click', () => {
    gaExamName.value = '';
    gaNextBtn.disabled = true;
  });

  gaNextBtn.addEventListener('click', () => {
    // proceed to step 2
    gaStep1.style.display = 'none';
    gaStep2.style.display = 'block';
    fetchUploadedFiles();
  });
}

if (gaBackBtn) {
  gaBackBtn.addEventListener('click', () => {
    gaStep2.style.display = 'none';
    gaStep1.style.display = 'block';
    gaGenerateBtn.disabled = true;
  });
}

function fetchUploadedFiles() {
  if (!gaFilesList || !gaLoading) return;
  gaFilesList.style.display = 'none';
  gaLoading.style.display = 'block';
  gaFilesList.innerHTML = '';
  gaFiles = [];

  fetch('/get_uploaded_files/?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      gaLoading.style.display = 'none';
      if (data.status === 'success' && Array.isArray(data.files)) {
        gaFiles = data.files;
        renderGaFiles(gaFiles);
      } else {
        gaFilesList.innerHTML = '<li style="padding:12px;color:#666;">No files found.</li>';
        gaFilesList.style.display = 'block';
      }
    })
    .catch(err => {
      gaLoading.style.display = 'none';
      gaFilesList.innerHTML = '<li style="padding:12px;color:#c62828;">Error loading files.</li>';
      gaFilesList.style.display = 'block';
      console.error('Error fetching files:', err);
    });
}

function renderGaFiles(files) {
  gaFilesList.innerHTML = '';
  if (!files || files.length === 0) {
    gaFilesList.innerHTML = '<li style="padding:12px;color:#666;">No files uploaded yet.</li>';
    gaFilesList.style.display = 'block';
    return;
  }

  files.forEach(f => {
    const li = document.createElement('li');
    li.style.padding = '8px';
    li.style.borderBottom = '1px solid #f0f0f0';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = f.id;
    checkbox.style.marginRight = '10px';
    checkbox.addEventListener('change', onGaSelectionChange);
    const label = document.createElement('span');
    label.textContent = `${f.file_name} (${f.year || ''})`;
    li.appendChild(checkbox);
    li.appendChild(label);
    gaFilesList.appendChild(li);
  });

  gaFilesList.style.display = 'block';
}

function onGaSelectionChange() {
  const checked = Array.from(gaFilesList.querySelectorAll('input[type=checkbox]:checked'));
  gaGenerateBtn.disabled = checked.length === 0;
}

if (gaFileFilter) {
  gaFileFilter.addEventListener('input', () => {
    const q = gaFileFilter.value.trim().toLowerCase();
    const filtered = gaFiles.filter(f => f.file_name.toLowerCase().includes(q));
    renderGaFiles(filtered);
  });
}

if (gaShowAll) {
  gaShowAll.addEventListener('click', () => {
    gaFileFilter.value = '';
    renderGaFiles(gaFiles);
  });
}

if (gaGenerateBtn) {
  gaGenerateBtn.addEventListener('click', () => {
    const checked = Array.from(gaFilesList.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);
    const exam = encodeURIComponent(gaExamName.value.trim());
    if (checked.length === 0) return;
    // Open new window to backend endpoint (backend implementation may be required)
    const url = `/generate_attendance/?exam_name=${exam}&file_ids=${checked.join(',')}`;
    window.open(url, '_blank');
  });
}




