'use strict';

//================================
//  Configuration
//================================

const DEFAULT_WORK_DURATION = 25 * 60;  
const DEFAULT_BREAK_DURATION = 5 * 60;

const MUSIC_MODES = {
    focus:    'lofi',
    pause:    'jazz',
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
let oldAudioReference = null;
let activeFadeInterval = null;
let nextTrackName     = "";
let latestStreamUrl = null; 
let currentMode       = 'focus'; 


//================================
//  DOM Targeting
//================================

const sessionTitleDisplay   = document.getElementById('current-session-title');
const timerDisplay          = document.getElementById('timer-display'); 
const startBtn              = document.getElementById('start-timer-btn');
const pauseBtn              = document.getElementById('pause-timer-btn');
const trackTitleDisplay     = document.getElementById('track-title-display');
const textarea              = document.querySelector('.notes-textarea');
const lineNumbersContainer  = document.querySelector('.line-numbers');
const volumeSlider          = document.getElementById('volume-slider');
const volumeIcon            = document.getElementById('volume-icon');
const vinyl                 = document.querySelector('.lucide-disc-3');
const refreshBtn            = document.getElementById('refresh-music-btn');
const wrapper               = document.querySelector('.track-title-wrapper');


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

function checkTitleOverflow(originalText) {
    if (!wrapper || !trackTitleDisplay) return;
    trackTitleDisplay.classList.remove('is-scrolling');
    trackTitleDisplay.innerText = originalText;

    if (trackTitleDisplay.scrollWidth > wrapper.clientWidth) {
        const spacer = "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0";
        const decoratedText = originalText + spacer;
        
        trackTitleDisplay.innerText = decoratedText + decoratedText;
        
        trackTitleDisplay.classList.add('is-scrolling');
    }
}

function updateBannerTitle(text) {
    if (trackTitleDisplay) {
        checkTitleOverflow(text);
    }
}

async function initDefaultStation(mode = 'focus') {
    const genre = MUSIC_MODES[mode];
    console.log(`LOG [Init]: Pre-loading default ${genre} station silently on startup...`);
    updateBannerTitle(`Loading ${genre}...`);

    try {
        const response = await fetch(
            `https://de1.api.radio-browser.info/json/stations/bytag/${genre}?limit=10&hidebroken=true&order=clickcount`
        );
        const stations = await response.json();
        if (!stations.length) throw new Error('No stations found for startup');

        const station = stations[Math.floor(Math.random() * stations.length)];
        
        currentAudio = new Audio(station.url_resolved);
        currentAudio.volume = 0;
        
        updateBannerTitle(`${station.name}`);
        if (vinyl) vinyl.style.animationPlayState = 'paused';
        console.log(`LOG [Init]: Silent stream "${station.name}" buffering in background.`);

        currentAudio.play().catch(autoplayError => {
            console.warn("LOG [Init Warning]: Autoplay policy restricted background streaming. Ready for user click.", autoplayError);
        });

    } catch (error) {
        console.error("LOG [Init Error]: Failed to silent-load on startup:", error);
        updateBannerTitle(`Radio déconnectée (Cliquez pour charger)`);
    }
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

function fetchAndPlayBackgroundMusic(mode = 'focus', action = "normal") {
    const genre = MUSIC_MODES[mode];
    
    // FIX: Standardized fade duration definition
    const fadeDuration = (action === "refresh") ? 3000 : 7000;
    
    if (action === "refresh" && refreshBtn) {
        refreshBtn.classList.add('is-loading');
    }

    if (nextTrackUrl) {
        console.log(`LOG [Music]: Lancement de la station préchargée (${genre}).`);
        updateBannerTitle(` ${nextTrackName || genre}`);
        playStation(nextTrackUrl, fadeDuration);
        
        nextTrackUrl = null; 
        nextTrackName = ""; 
    } else {
        console.log(`LOG [Music Backup]: Pas de préchargement, appel direct...`);
        updateBannerTitle(`Chargement ${genre}...`);
        
        fetch(`https://de1.api.radio-browser.info/json/stations/bytag/${genre}?limit=10&hidebroken=true&order=clickcount`)
            .then(res => res.json())
            .then(stations => {
                if (stations.length) {
                    const station = stations[Math.floor(Math.random() * stations.length)];
                    updateBannerTitle(`${station.name}`);
                    playStation(station.url_resolved, fadeDuration);
                } else {
                    if (refreshBtn) refreshBtn.classList.remove('is-loading');
                }
            })
            .catch(err => {
                console.error("Error direct load:", err);
                if (refreshBtn) refreshBtn.classList.remove('is-loading');
            });
    }
}

function playStation(streamUrl, fadeDuration = 7000) {
    latestStreamUrl = streamUrl;

    const maxVolume = volumeSlider ? parseFloat(volumeSlider.value) : 0.5;
    const newAudio = new Audio(streamUrl);
    const isTimerRunning = vinyl ? (vinyl.style.animationPlayState === 'running') : false;
    
    const refreshBtn = document.getElementById('refresh-music-btn');
    
    if (isTimerRunning) {
        newAudio.volume = 0;
        const playPromise = newAudio.play();

        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    if (streamUrl !== latestStreamUrl) {
                        console.log("LOG [Player]: Ghost stream detected and terminated.");
                        newAudio.pause();
                        newAudio.src = "";
                        return;
                    }

                    const stillRunning = vinyl ? (vinyl.style.animationPlayState === 'running') : false;
                    if (!stillRunning) {
                        console.log("LOG [Player]: User paused during buffering. Arming silently.");
                        newAudio.pause();
                        newAudio.volume = maxVolume;
                        if (refreshBtn) refreshBtn.classList.remove('is-loading');
                        if (currentAudio) currentAudio.pause();
                        currentAudio = newAudio;
                        return;
                    }

                    console.log("LOG [Player]: New stream started playing (Active Mode).");
                    if (refreshBtn) refreshBtn.classList.remove('is-loading');
                    if (vinyl) vinyl.style.animationPlayState = 'running';
                    
                    if (currentAudio) {
                        if (activeFadeInterval) {
                            clearInterval(activeFadeInterval);
                            activeFadeInterval = null;
                            if (oldAudioReference) {
                                oldAudioReference.pause();
                                oldAudioReference.src = "";
                            }
                        }

                        oldAudioReference = currentAudio;     
                        const intervalStep = 100;     
                        const totalSteps = fadeDuration / intervalStep;
                        let currentStep = 0;

                        activeFadeInterval = setInterval(() => {
                            currentStep++;
                            const progress = currentStep / totalSteps;

                            if (oldAudioReference) {
                                oldAudioReference.volume = Math.max(0, maxVolume * (1 - progress));
                            }
                            newAudio.volume = Math.min(maxVolume, maxVolume * progress);

                            if (currentStep >= totalSteps) {
                                clearInterval(activeFadeInterval);
                                activeFadeInterval = null;
                                
                                if (oldAudioReference) {
                                    oldAudioReference.pause();
                                    oldAudioReference = null;
                                }
                                console.log("LOG [Player]: Crossfade complete. Old audio stopped.");
                            }
                        }, intervalStep);
                    } else {
                        newAudio.volume = maxVolume;
                    }

                    currentAudio = newAudio;
                })
                .catch(err => {
                    if (refreshBtn) refreshBtn.classList.remove('is-loading');
                    if (err.name === "AbortError") {
                        console.log("LOG [Player]: Lecture annulée par un appel de pause rapide.");
                    } else {
                        console.error("LOG [Player Error]: Impossible de lire ce flux.", err);
                        // Only retry if this failure belongs to the latest request
                        if (streamUrl === latestStreamUrl) {
                            fetchAndPlayBackgroundMusic(currentMode);
                        }
                    }
                });
        }
    } 
    else {
        console.log("LOG [Player]: New stream successfully armed in PAUSE mode.");
        if (refreshBtn) refreshBtn.classList.remove('is-loading');
        if (vinyl) vinyl.style.animationPlayState = 'paused';
        
        newAudio.volume = maxVolume;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = "";
        }
        currentAudio = newAudio;
    }
}

function fadeInCurrentAudio() {
    if (!currentAudio) return;
    
    if (vinyl) vinyl.style.animationPlayState = 'running';
    
    const maxVolume = volumeSlider ? parseFloat(volumeSlider.value) : 0.5;
    const fadeDuration = 2000; 
    const intervalStep = 100;
    const totalSteps = fadeDuration / intervalStep;
    let currentStep = 0;

    if (trackTitleDisplay && trackTitleDisplay.innerText.includes('Prêt')) {
        const match = trackTitleDisplay.innerText.match(/\(([^)]+)\)/);
        if (match && match[1]) {
            updateBannerTitle(`${match[1]}`);
        } else {
            updateBannerTitle(`${MUSIC_MODES[currentMode]}`);
        }
    }

    currentAudio.play().catch(err => console.error("Fade in play trigger failed:", err));

    const fadeInterval = setInterval(() => {
        currentStep++;
        currentAudio.volume = Math.min(maxVolume, maxVolume * (currentStep / totalSteps));

        if (currentStep >= totalSteps) {
            clearInterval(fadeInterval);
            console.log("LOG [Player]: Startup track successfully faded in.");
        }
    }, intervalStep);
}

function playCountdownBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine'; 
        oscillator.frequency.value = 850;
        
        const appVolume = volumeSlider ? parseFloat(volumeSlider.value) : 0.5;
        const targetVolume = appVolume * 0.7;

        gainNode.gain.setValueAtTime(targetVolume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.12);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.12); 
    } catch (error) {
        console.error("LOG [Audio]: Failed to play countdown beep:", error);
    }
}

function playMusic()  { currentAudio?.play(); }

function pauseMusic() {
    if (activeFadeInterval) {
        clearInterval(activeFadeInterval);
        activeFadeInterval = null;
    }

    if (currentAudio) {
        currentAudio.pause();
    }

    if (oldAudioReference) {
        oldAudioReference.pause();
        oldAudioReference = null;
    }

    if (vinyl) vinyl.style.animationPlayState = 'paused';
    console.log("LOG [Player]: Emergency stop! All audio streams paused instantly.");
}

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
    
    if (timeLeft <= 0) {
        timeLeft = currentMode === 'focus' ? currentSession.workTime : currentSession.breakTime;
    }

    if (vinyl) vinyl.style.animationPlayState = 'running';

    if (currentAudio && currentAudio.volume === 0) {
        fadeInCurrentAudio();
    } else if (currentAudio && currentAudio.paused) {
        playMusic();
    } else if (!currentAudio) {
        fetchAndPlayBackgroundMusic(currentMode);
    }

    timerInterval = setInterval(() => {
        if (timeLeft > 0) {
            timeLeft--;
            updateDisplay();

            if (timeLeft === 10) {
                updateBannerTitle(`⏳ Loading next station...`);
                const nextMode = (currentMode === 'focus') ? 'pause' : 'focus';

                preloadNextMusic(nextMode).then(() => {
                    fetchAndPlayBackgroundMusic(nextMode);
                });
            }
            if (timeLeft <= 7 && timeLeft > 0) {
                playCountdownBeep();
            }
            
        } else {
            if (currentMode === 'focus') {
                showNotification("✅ Session terminée ! La pause commence.");
                currentMode = 'pause';
                timeLeft = currentSession.breakTime;
            } else {
                showNotification("💪 Pause terminée ! Retour au travail.");
                currentMode = 'focus';
                timeLeft = currentSession.workTime;
            }
            updateDisplay(); 
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
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 21;
    const visibleLines = Math.floor(textarea.clientHeight / lineHeight);
    const lineCount = Math.max(visibleLines, lines.length);
    
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

function getActiveSession() {
    return sessions.find(s => s.name === activeSessionName) || sessions[0];
}

//================================
//      Add Session Window
//================================

function openSessionModal() {
    if (!sessionModal || !newSessionInput) return;
    newSessionInput.value = ''; 

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

    const workMinutes = (modalWorkInput && modalWorkInput.value) ? parseInt(modalWorkInput.value, 10) : 25;
    const breakMinutes = (modalBreakInput && modalBreakInput.value) ? parseInt(modalBreakInput.value, 10) : 5;

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
    initDefaultStation();
    if (startBtn) startBtn.addEventListener('click', startTimer);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log("LOG [UI]: Refresh button triggered.");
            fetchAndPlayBackgroundMusic(currentMode, "refresh");
        });
    }

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

    window.addEventListener('resize', updateLineNumbers);
    loadSessionsFromStorage();
    renderSessionsList();
    updateDisplay();
    window.switchSessionNotes();
});