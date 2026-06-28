'use strict';

//================================
//  Configuration
//================================

const DEFAULT_WORK_DURATION = 25 * 60;  
const DEFAULT_BREAK_DURATION = 5 * 60;

const MUSIC_MODES = {
    focus:    'lofi',
    pause:    'jazz',
    boost:    'electronic',
    winddown: 'ambient',
};  

//================================
//  State Variables
//================================

let sessions          = [{ name: "Ma première Session", workTime: DEFAULT_WORK_DURATION, breakTime: DEFAULT_BREAK_DURATION }]; 
let activeSessionName = "Ma première Session";
let timeLeft          = DEFAULT_WORK_DURATION;
let timerInterval     = null;
let currentAudio      = null;
let nextTrackUrl      = null;
let nextTrackName     = "";
let currentMode       = 'focus'; 


//================================
//  DOM Targeting
//================================

const sessionTitleDisplay   = document.getElementById('current-session-title');
const timerDisplay          = document.getElementById('timer-display'); 
const startBtn              = document.getElementById('start-timer-btn');
const pauseBtn              = document.getElementById('pause-timer-btn');
const trackTitleDisplay    = document.getElementById('track-title-display');
const textarea              = document.querySelector('.notes-textarea');
const lineNumbersContainer = document.querySelector('.line-numbers');
const volumeSlider          = document.getElementById('volume-slider');
const volumeIcon            = document.getElementById('volume-icon');

// Session elements
const sessionsListContainer = document.getElementById('sessions-list');
const addSessionBtn         = document.getElementById('add-session-btn');
const suppSessionBtn        = document.getElementById('supp-session-btn');

//Session Add window elements
const sessionModal          = document.getElementById('session-modal');
const newSessionInput       = document.getElementById('new-session-input');
const modalCancelBtn        = document.getElementById('modal-cancel-btn');
const modalConfirmBtn       = document.getElementById('modal-confirm-btn');

//Session Supp window elements
const deleteModal           = document.getElementById('delete-modal');
const deleteModalText       = document.getElementById('delete-modal-text');
const deleteCancelBtn       = document.getElementById('delete-cancel-btn');
const deleteConfirmBtn      = document.getElementById('delete-confirm-btn');

//Parameter Window
const parameterModal         = document.getElementById('parameter-modal');
const parameterNameModalText = document.getElementById('parameter-name-modal-text');
const editNameSessionInput   = document.getElementById('edit-name-session-input'); 
const parameterBackBtn       = document.getElementById('parameter-back-btn');
const parameterSaveBtn       = document.getElementById('parameter-save-btn');
const parameterSessionBtn    = document.getElementById('parameter-session-btn'); 
const workInput              = document.getElementById('edit-time-work-input');
const breakInput             = document.getElementById('edit-time-break-input');

//================================
//  Notification System
//================================

function showNotification(message) {
    let notif = document.getElementById('session-notification');

    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'session-notification';
        notif.style.cssText = [
            'position: fixed',
            'top: 20px',
            'left: 50%',
            'transform: translateX(-50%)',
            'background: #323232',
            'color: #fff',
            'padding: 12px 24px',
            'border-radius: 8px',
            'font-size: 15px',
            'z-index: 9999',
            'box-shadow: 0 4px 12px rgba(0,0,0,.3)',
            'transition: opacity .4s ease',
        ].join('; ');
        document.body.appendChild(notif);
    }

    notif.textContent = message;
    notif.style.opacity = '1';

    setTimeout(() => { notif.style.opacity = '0'; }, 4000);
}

//========================================
//  Background Music (Radio Browser API)
//========================================

function updateBannerTitle(title) {
    if (trackTitleDisplay) trackTitleDisplay.innerText = title;
}

async function preloadNextMusic(nextMode) {
    const genre = MUSIC_MODES[nextMode];
    console.log(`LOG [Preload]: Recherche d'une station ${genre} en arrière-plan...`);

    try {
        const response = await fetch(
            `https://de1.api.radio-browser.info/json/stations/bytag/${genre}?limit=10&hidebroken=true&order=clickcount`
        );
        const stations = await response.json();
        if (!stations.length) throw new Error('No stations found');

        const station = stations[Math.floor(Math.random() * stations.length)];
        
        nextTrackUrl = station.url_resolved;
        nextTrackName = station.name; 
        
        console.log(`LOG [Preload]: Station "${station.name}" prête.`);

    } catch (error) {
        console.error("LOG [Preload Error]:", error);
        nextTrackUrl = null;
        nextTrackName = "";
    }
}

function fetchAndPlayBackgroundMusic(mode = 'focus') {
    const genre = MUSIC_MODES[mode];
    
    if (nextTrackUrl) {
        console.log(`LOG [Music]: Lancement de la station préchargée (${genre}).`);
        updateBannerTitle(`🎵 : ${nextTrackName || genre}`);
        playStation(nextTrackUrl);
        
        nextTrackUrl = null; 
        nextTrackName = ""; 
    } else {
        console.log(`LOG [Music Backup]: Pas de préchargement, appel direct...`);
        updateBannerTitle(`🎵 : Chargement ${genre}...`);
        
        fetch(`https://de1.api.radio-browser.info/json/stations/bytag/${genre}?limit=10&hidebroken=true&order=clickcount`)
            .then(res => res.json())
            .then(stations => {
                if (stations.length) {
                    const station = stations[Math.floor(Math.random() * stations.length)];
                    updateBannerTitle(`🎵 : ${station.name}`);
                    playStation(station.url_resolved);
                }
            })
            .catch(err => console.error("Error direct load:", err));
    }
}

function playStation(streamUrl) {
    if (currentAudio) { 
        currentAudio.pause(); 
        currentAudio = null; 
    }

    currentAudio = new Audio(streamUrl);
    currentAudio.volume = volumeSlider ? volumeSlider.value : 0.5;
    
    const playPromise = currentAudio.play();

    if (playPromise !== undefined) {
        playPromise
            .then(() => {
                console.log("LOG [Player]: Stream playing.");
            })
            .catch(err => {
                if (err.name === "AbortError") {
                    console.log("LOG [Player]: Lecture annulée par un appel de pause rapide.");
                } else {
                    console.error("LOG [Player Error]: Impossible de lire ce flux (Lien mort ou bloqué).", err);
                    fetchAndPlayBackgroundMusic(currentMode);
                }
            });
    }
}

function playMusic()  { currentAudio?.play(); }
function pauseMusic() { currentAudio?.pause(); }

//================================
//  Timer Logic
//================================

function updateDisplay() {
    if (sessionTitleDisplay) {
        sessionTitleDisplay.innerText = activeSessionName;
    }

    if (!timerDisplay) return;

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerDisplay.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startTimer() {
    if (timerInterval !== null) return;

    const currentSession = getActiveSession();
    
    if (timeLeft === DEFAULT_WORK_DURATION && currentMode === 'focus') {
        timeLeft = currentSession.workTime;
    }

    currentMode = 'focus';
    fetchAndPlayBackgroundMusic(currentMode);

    timerInterval = setInterval(() => {
        if (timeLeft > 0) {
            timeLeft--;
            updateDisplay();

            if (timeLeft === 10) {
                const nextMode = (currentMode === 'focus' || currentMode === 'boost') ? 'pause' : 'focus';
                updateBannerTitle(`🎵 : Recherche de la prochaine radio...`);
                
                preloadNextMusic(nextMode).then(() => {
                    if (nextTrackName && timeLeft <= 10 && timeLeft > 0) {
                        updateBannerTitle(`⏳ Prochaine radio : ${nextTrackName}`);
                    }
                });
            }

            if (timeLeft === 5 * 60 && currentMode !== 'boost') {
                currentMode = 'boost';
                fetchAndPlayBackgroundMusic('boost');
            }
            
        } else {
            if (currentMode === 'focus' || currentMode === 'boost') {
                showNotification("✅ Session terminée ! La pause commence.");
                currentMode = 'pause';
                timeLeft = currentSession.breakTime;
            } else {
                showNotification("💪 Pause terminée ! Retour au travail.");
                currentMode = 'focus';
                timeLeft = currentSession.workTime;
            }

            updateDisplay(); 
            fetchAndPlayBackgroundMusic(currentMode);
        }
    }, 1000);
}

function pauseTimer() {
    if (timerInterval === null) return;
    clearInterval(timerInterval);
    timerInterval = null;
    pauseMusic();
}

//================================
//  Notes Management Logic
//================================

function getNoteKey() {
    const name = activeSessionName || "ma_premiere_session";
    const formattedName = name.toLowerCase().replace(/\s+/g, '_');
    return `note_session_${formattedName}`;
}

function updateLineNumbers() {
    if (!textarea || !lineNumbersContainer) return;
    const lines = textarea.value.split('\n');
    const lineCount = Math.max(35, lines.length);
    
    let linesHTML = '';
    for (let i = 1; i <= lineCount; i++) {
        linesHTML += `<span>${i}</span>`;
    }
    lineNumbersContainer.innerHTML = linesHTML;
}

window.switchSessionNotes = function() {
    if (!textarea) return;
    const key = getNoteKey();
    const savedNote = localStorage.getItem(key);
    
    textarea.value = savedNote !== null ? savedNote : '';
    updateLineNumbers();
};

//================================
//  Session Management & Interface
//================================

function saveSessionsToStorage() {
    localStorage.setItem('pomodoro_sessions_list', JSON.stringify(sessions));
    localStorage.setItem('pomodoro_active_session', activeSessionName);
}

function loadSessionsFromStorage() {
    const storedSessions = localStorage.getItem('pomodoro_sessions_list');
    const storedActive   = localStorage.getItem('pomodoro_active_session');

    if (storedSessions) {
        try {
            sessions = JSON.parse(storedSessions);
        } catch (e) {
            sessions = [];
        }
    }
    if (!Array.isArray(sessions) || sessions.length === 0) {
        sessions = [{ name: "Ma première Session", workTime: DEFAULT_WORK_DURATION, breakTime: DEFAULT_BREAK_DURATION }];
    }
    if (storedActive && sessions.some(s => s.name === storedActive)) {
        activeSessionName = storedActive;
    } else if (sessions.length > 0) {
        activeSessionName = sessions[0].name;
    }
    timeLeft = getActiveSession().workTime;
}

function renderSessionsList() {
    if (!sessionsListContainer) return;
    sessionsListContainer.innerHTML = ''; 

    sessions.forEach(session => {
        const sessionItem = document.createElement('div');
        sessionItem.classList.add('session-item');
        
        if (session.name === activeSessionName) {
            sessionItem.classList.add('active');
        }
        
        sessionItem.textContent = `- ${session.name}`;
        sessionItem.addEventListener('click', () => {
            selectSession(session.name);
        });

        sessionsListContainer.appendChild(sessionItem);
    });
}

function selectSession(sessionName) {
    if (activeSessionName === sessionName) return;

    // FIX : On force le nettoyage complet de l'intervalle lors du changement pour éviter l'effet de vitesse
    pauseTimer(); 

    activeSessionName = sessionName;
    saveSessionsToStorage();

    renderSessionsList();
    window.switchSessionNotes();

    const currentSession = getActiveSession();
    currentMode = 'focus';
    timeLeft = currentSession.workTime; 
    
    updateDisplay();
}

/**
 * Retourne l'objet complet de la session active
 */
function getActiveSession() {
    return sessions.find(s => s.name === activeSessionName) || sessions[0];
}

//================================
//      Add Session Window
//================================

function openSessionModal() {
    if (!sessionModal || !newSessionInput) return;
    newSessionInput.value = ''; 

    // Pré-remplit les valeurs de temps par défaut dans la fenêtre d'ajout
    const modalWorkInput = document.getElementById('modal-time-work-input');
    const modalBreakInput = document.getElementById('modal-time-break-input');
    if (modalWorkInput) modalWorkInput.value = 25;
    if (modalBreakInput) modalBreakInput.value = 5;

    sessionModal.classList.add('open'); 
    newSessionInput.focus(); 
}

function closeSessionModal() {
    if (sessionModal) {
        sessionModal.classList.remove('open');
    }
}

function confirmSessionCreation() {
    const name = newSessionInput.value.trim();
    const modalWorkInput = document.getElementById('modal-time-work-input');
    const modalBreakInput = document.getElementById('modal-time-break-input');
    
    if (!name) return; 
    
    if (sessions.some(s => s.name === name)) {
        showNotification("⚠️ Une session avec ce nom existe déjà !");
        return;
    }

    // FIX : Récupère les valeurs saisies par l'utilisateur ou applique les valeurs par défaut
    const workMinutes = (modalWorkInput && modalWorkInput.value) ? parseInt(modalWorkInput.value, 10) : 25;
    const breakMinutes = (modalBreakInput && modalBreakInput.value) ? parseInt(modalBreakInput.value, 10) : 5;

    // FIX : Enregistre l'objet de session complet avec les durées configurées
    sessions.push({
        name: name,
        workTime: workMinutes * 60,
        breakTime: breakMinutes * 60
    });

    saveSessionsToStorage();
    selectSession(name);
    closeSessionModal();
}

//================================
//     Delete Session Window
//================================

function openDeleteModal() {
    if (sessions.length === 0) return;
    
    if (deleteModalText) {
        deleteModalText.textContent = `Voulez-vous vraiment supprimer la session "${activeSessionName}" et toutes ses notes ?`;
    }
    
    if (deleteModal) deleteModal.classList.add('open');
}

function closeDeleteModal() {
    if (deleteModal) deleteModal.classList.remove('open');
}

function executeDelete() {
    const noteKey = getNoteKey();
    localStorage.removeItem(noteKey);

    const indexToRemove = sessions.findIndex(s => s.name === activeSessionName);
    if (indexToRemove > -1) {
        sessions.splice(indexToRemove, 1);
    }

    if (sessions.length > 0) {
        const nextIndex = Math.max(0, indexToRemove - 1);
        activeSessionName = sessions[nextIndex].name;
    } else {
        activeSessionName = "Ma première Session";
        sessions.push({
            name: activeSessionName,
            workTime: DEFAULT_WORK_DURATION,
            breakTime: DEFAULT_BREAK_DURATION
        });
    }

    saveSessionsToStorage();
    renderSessionsList();
    window.switchSessionNotes();
    
    pauseTimer();
    timeLeft = getActiveSession().workTime;
    updateDisplay();

    closeDeleteModal();
    showNotification("🗑️ Session supprimée avec succès.");
}

//================================
//  Parameter Window
//================================

function openParameterModal() {
    if (!activeSessionName) return;

    if (parameterNameModalText) {
        parameterNameModalText.textContent = `Nom actuel :`;
    }
    if (editNameSessionInput) {
        editNameSessionInput.value = activeSessionName;
        setTimeout(() => editNameSessionInput.select(), 50); 
    }

    const currentSession = getActiveSession();
    if (workInput) workInput.value = currentSession.workTime / 60;
    if (breakInput) breakInput.value = currentSession.breakTime / 60;

    if (parameterModal) parameterModal.classList.add('open');
}

function closeParameterModal() {
    if (parameterModal) parameterModal.classList.remove('open');
}

function saveParameterChanges() {
    const newName = editNameSessionInput.value.trim();

    if (!newName) {
        alert("Le nom de la session ne peut pas être vide !");
        return;
    }

    const isNameTaken = sessions.some(s => s.name === newName && s.name !== activeSessionName);
    if (isNameTaken) {
        alert("Une autre session porte déjà ce nom !");
        return;
    }

    const oldNoteKey = getNoteKey();
    const currentNotes = localStorage.getItem(oldNoteKey);

    const currentSession = getActiveSession();
    
    currentSession.name = newName;
    if (workInput && workInput.value) currentSession.workTime = parseInt(workInput.value, 10) * 60;
    if (breakInput && breakInput.value) currentSession.breakTime = parseInt(breakInput.value, 10) * 60;

    activeSessionName = newName;

    const newNoteKey = getNoteKey();
    if (currentNotes !== null && oldNoteKey !== newNoteKey) {
        localStorage.setItem(newNoteKey, currentNotes);
        localStorage.removeItem(oldNoteKey);
    }

    saveSessionsToStorage();
    renderSessionsList();
    
    pauseTimer();
    currentMode = 'focus';
    timeLeft = currentSession.workTime; 
    updateDisplay();
    closeParameterModal();
    showNotification("✏️ Paramètres mis à jour !");
}

//================================
//  Initialization & Event Listeners
//================================

document.addEventListener('DOMContentLoaded', () => {

    if (startBtn) startBtn.addEventListener('click', startTimer);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);

    if (textarea) {
        textarea.addEventListener('input', () => {
            localStorage.setItem(getNoteKey(), textarea.value);
            updateLineNumbers();
        });

        textarea.addEventListener('scroll', () => {
            if (lineNumbersContainer) lineNumbersContainer.scrollTop = textarea.scrollTop;
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault(); 
                
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const currentValue = textarea.value;

                const tabSpaces = "    "; 
                textarea.value = currentValue.substring(0, start) + tabSpaces + currentValue.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + tabSpaces.length;

                textarea.dispatchEvent(new Event('input'));
            }
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const volumeValue = e.target.value;
            
            if (currentAudio) {
                currentAudio.volume = volumeValue;
            }
            
            if (parseFloat(volumeValue) === 0) {
                volumeIcon.textContent = "🔇";
            } else if (volumeValue < 0.4) {
                volumeIcon.textContent = "🔈";
            } else {
                volumeIcon.textContent = "🔊";
            }
        });
    }

    if (addSessionBtn) addSessionBtn.addEventListener('click', openSessionModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeSessionModal);
    if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', confirmSessionCreation);

    // FIX : Ajout des touches Entrée / Échap spécifiques sur les nouveaux inputs de temps
    const modalWorkInput = document.getElementById('modal-time-work-input');
    const modalBreakInput = document.getElementById('modal-time-break-input');
    const inputsCreation = [newSessionInput, modalWorkInput, modalBreakInput];
    
    inputsCreation.forEach(inputEl => {
        if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') confirmSessionCreation();
                if (e.key === 'Escape') closeSessionModal();
            });
        }
    });

    if (sessionModal) {
        sessionModal.addEventListener('click', (e) => {
            if (e.target === sessionModal) closeSessionModal();
        });
    }

    if (suppSessionBtn) {
        suppSessionBtn.addEventListener('click', openDeleteModal);
    }

    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', closeDeleteModal);
    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', executeDelete);

    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
    }

    if (parameterSessionBtn) {
        parameterSessionBtn.addEventListener('click', openParameterModal);
    }

    if (parameterBackBtn) parameterBackBtn.addEventListener('click', closeParameterModal);
    if (parameterSaveBtn) parameterSaveBtn.addEventListener('click', saveParameterChanges);

    const inputsParametres = [editNameSessionInput, workInput, breakInput];
    inputsParametres.forEach(paramEl => {
        if (paramEl) {
            paramEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveParameterChanges();
            });
        }
    });

    if (parameterModal) {
        parameterModal.addEventListener('click', (e) => {
            if (e.target === parameterModal) closeParameterModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSessionModal();
            closeDeleteModal();
            closeParameterModal();
        }
    });

    loadSessionsFromStorage();
    renderSessionsList();
    updateDisplay();
    window.switchSessionNotes();
});