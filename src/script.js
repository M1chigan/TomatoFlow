'use strict';

//================================
//  Tauri imports
//================================

// Accessing APIs via global window object (Vanilla JS)
const { getVersion } = window.__TAURI__.app;
const { listen } = window.__TAURI__.event;

// Plugin global references (if enabled in Tauri v2)
const { load } = window.__TAURI_PLUGIN_STORE__;
const { register } = window.__TAURI_PLUGIN_GLOBAL_SHORTCUT__;

//================================
//  Configuration
//================================

const DEFAULT_WORK_DURATION = 25 * 60;  
const DEFAULT_BREAK_DURATION = 5 * 60;

//================================
//  State Variables
//================================

let sessions           = [{ name: "Ma première Session", workTime: DEFAULT_WORK_DURATION, breakTime: DEFAULT_BREAK_DURATION }]; 
let activeSessionName  = "Ma première Session";
let timeLeft           = DEFAULT_WORK_DURATION;
let timerInterval      = null;
let currentAudio       = null;
let nextTrackUrl       = null;
let oldAudioReference  = null;
let activeFadeInterval = null;
let nextTrackName      = "";
let latestStreamUrl    = null; 
let currentMode        = 'focus'; 
const usedStations     = new Set();
let flowQueue          = [];

// TAURI: persistent store reference
let tauriStore          = null;

//================================
//  DOM Targeting
//================================

const sessionTitleDisplay   = document.getElementById('current-session-title');
const timerDisplay          = document.getElementById('timer-display'); 
const startBtn              = document.getElementById('start-timer-btn');
const pauseBtn              = document.getElementById('pause-timer-btn');
const trackTitleDisplay     = document.getElementById('track-title-display');
const notepad               = document.getElementById('notepad');
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

// Session Add window elements
const sessionModal          = document.getElementById('session-modal');
const newSessionInput       = document.getElementById('new-session-input');
const modalCancelBtn        = document.getElementById('modal-cancel-btn');
const modalConfirmBtn       = document.getElementById('modal-confirm-btn');
const creationFocusSelect   = document.getElementById('creation-focus-genre');
const creationBreakSelect   = document.getElementById('creation-break-genre');
const settingsFocusSelect   = document.getElementById('settings-focus-genre');
const settingsBreakSelect   = document.getElementById('settings-break-genre');

// Session Supp window elements
const deleteModal           = document.getElementById('delete-modal');
const deleteModalText       = document.getElementById('delete-modal-text');
const deleteCancelBtn       = document.getElementById('delete-cancel-btn');
const deleteConfirmBtn      = document.getElementById('delete-confirm-btn');

// Parameter Window
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

function pickStation(stations) {
    const fresh = stations.filter(s => !usedStations.has(s.stationuuid));
    if (!fresh.length) usedStations.clear();
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    usedStations.add(pick.stationuuid);
    return pick;
}

async function fetchStations(genre) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const [byTag, byName] = await Promise.all([
        fetch(
            `https://de1.api.radio-browser.info/json/stations/bytag/${genre}?limit=20&hidebroken=true&order=votes&reverse=true&codec=MP3&bitrateMin=128`,
            { signal: controller.signal }
        ).then(r => r.json()).catch(() => []),
        fetch(
            `https://de1.api.radio-browser.info/json/stations/byname/${genre}?limit=20&hidebroken=true&order=votes&reverse=true&codec=MP3&bitrateMin=128`,
            { signal: controller.signal }
        ).then(r => r.json()).catch(() => []),
    ]);

    clearTimeout(timeout);

    const seen = new Set();
    return [...byTag, ...byName].filter(s => {
        if (seen.has(s.stationuuid)) return false;
        seen.add(s.stationuuid);
        return true;
    });
}

function getGenreForMode(mode) {
    const currentSession = getActiveSession();
    if (mode === 'focus') {
        return currentSession.focusGenre || 'lofi';
    }
    return currentSession.breakGenre || 'jazz'; 
}

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
    const genre = getGenreForMode(mode);
    console.log(`LOG [Init]: Pre-loading default ${genre} station silently on startup...`);
    updateBannerTitle(`Loading ${genre}...`);

    try {
        const stations = await fetchStations(genre);
        if (!stations.length) throw new Error('No stations found for startup');
        const station = pickStation(stations);
                
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
    const genre = getGenreForMode(nextMode);
    console.log(`LOG [Preload]: Recherche d'une station ${genre} en arrière-plan...`);

    try {
        const stations = await fetchStations(genre);
        if (!stations.length) throw new Error('No stations found');
        const station = pickStation(stations);

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
    const genre = getGenreForMode(mode);
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
        
        fetchStations(genre)
            .then(stations => {
                if (stations.length) {
                    const station = pickStation(stations);
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
            updateBannerTitle(`${getGenreForMode(currentMode)}`);
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

function toggleMute() {
    if (!currentAudio) return;
    currentAudio.muted = !currentAudio.muted;

    if (volumeIcon) {
        volumeIcon.textContent = currentAudio.muted ? "🔇" : (parseFloat(volumeSlider?.value ?? 0.5) < 0.4 ? "🔈" : "🔊");
    }
    console.log(`LOG [Tauri]: Mute toggled -> ${currentAudio.muted}`);
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

    let currentSession = getActiveSession();
    
    if (timeLeft <= 0) {
        timeLeft = currentMode === 'focus' ? currentSession.workTime : currentSession.breakTime;
    }

    if (vinyl) vinyl.style.animationPlayState = 'running';
    if (currentAudio && currentAudio.volume === 0) fadeInCurrentAudio();
    else if (currentAudio && currentAudio.paused) playMusic();
    else if (!currentAudio) fetchAndPlayBackgroundMusic(currentMode);

    timerInterval = setInterval(() => {
        if (timeLeft > 0) {
            timeLeft--;
            updateDisplay();

            if (timeLeft === 10) {
                updateBannerTitle(`⏳ Loading next station...`);
                const nextMode = (currentMode === 'focus') ? 'pause' : 'focus';
                preloadNextMusic(nextMode).then(() => fetchAndPlayBackgroundMusic(nextMode));
            }
            if (timeLeft <= 7 && timeLeft > 0) playCountdownBeep();
            
        } else {
            currentSession = getActiveSession();

            if (currentMode === 'focus') {
                showNotification(`✅ Focus terminé ! La pause de ${activeSessionName} commence.`);
                currentMode = 'pause';
                timeLeft = currentSession.breakTime;
                updateDisplay();
            } else {
                showNotification("💪 Pause terminée ! Relance immédiate du Flow...");
                
                clearInterval(timerInterval);
                timerInterval = null;

                if (flowQueue.length > 0) {
                    const nextSessionName = flowQueue.shift(); 
                    selectSession(nextSessionName); 
                } else {
                    selectSession(activeSessionName); 
                }

                renderFlowList();
                
                currentMode = 'focus';
                timeLeft = 0; 
                startTimer(); 
                return;
            }
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
    if (!notepad || !lineNumbersContainer) return;
    
    const lines = notepad.innerText.split('\n');
    const computedStyle = window.getComputedStyle(notepad);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 21;
    const visibleLines = Math.floor(notepad.clientHeight / lineHeight);
    const lineCount = Math.max(visibleLines, lines.length);
    
    let linesHTML = '';
    for (let i = 1; i <= lineCount; i++) {
        linesHTML += `<span>${i}</span>`;
    }
    lineNumbersContainer.innerHTML = linesHTML;
}

window.switchSessionNotes = function() {
    if (!notepad) return;
    const key = getNoteKey();
    const savedNote = localStorage.getItem(key);
    
    notepad.innerHTML = savedNote !== null ? savedNote : '';
    updateLineNumbers();
};

//================================
//  Auto-Save & Interaction Events
//================================

if (notepad) {
    notepad.addEventListener('input', () => {
        const key = getNoteKey();
        localStorage.setItem(key, notepad.innerHTML);
        updateLineNumbers();
    });

    notepad.addEventListener('click', (event) => {
        if (event.target.classList.contains('task-checkbox')) {
            const key = getNoteKey();
            setTimeout(() => {
                localStorage.setItem(key, notepad.innerHTML);
            }, 10);
        }
    });

    notepad.addEventListener('keydown', (event) => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);

        if (event.ctrlKey && event.key.toLowerCase() === 'b') {
            event.preventDefault();

            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);

            const startContainer = range.startContainer;
            const currentElement = startContainer.nodeType === Node.ELEMENT_NODE 
                ? startContainer 
                : startContainer.parentElement;

            const existingTaskRow = currentElement?.closest('.task-row');

            if (!existingTaskRow) {
                const taskRow = document.createElement('div');
                taskRow.className = 'task-row';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'task-checkbox';

                const taskText = document.createElement('span');
                taskText.className = 'task-text';
                taskText.innerHTML = '&nbsp;'; 

                taskRow.appendChild(checkbox);
                taskRow.appendChild(taskText);

                range.deleteContents();
                range.insertNode(taskRow);

                range.setStart(taskText, 0);
                range.setEnd(taskText, 0);
                selection.removeAllRanges();
                selection.addRange(range);

                updateLineNumbers();
                localStorage.setItem(getNoteKey(), notepad.innerHTML);
                return;
            }
        }

        if (event.key === 'Tab') {
            event.preventDefault(); 

            const tabNode = document.createTextNode('\u00A0\u00A0\u00A0\u00A0');
            
            range.insertNode(tabNode);

            range.setStartAfter(tabNode);
            range.setEndAfter(tabNode);
            selection.removeAllRanges();
            selection.addRange(range);

            updateLineNumbers();
            localStorage.setItem(getNoteKey(), notepad.innerHTML);
            return;
        }

        if (event.key === 'Enter') {
            const targetNode = range.startContainer;
            const taskRow = targetNode.nodeType === Node.ELEMENT_NODE 
                ? targetNode.closest('.task-row') 
                : targetNode.parentElement.closest('.task-row');

            if (taskRow) {
                event.preventDefault();
                const taskText = taskRow.querySelector('.task-text');

                const newTaskRow = document.createElement('div');
                newTaskRow.className = 'task-row';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'task-checkbox';

                const newTaskText = document.createElement('span');
                newTaskText.className = 'task-text';

                if (taskText) {
                    const trailingRange = range.cloneRange();
                    trailingRange.setEndAfter(taskText);
                    const extractedContent = trailingRange.extractContents();

                    if (extractedContent.textContent.replace(/\u00A0/g, ' ').trim() === '') {
                        newTaskText.innerHTML = '&nbsp;';
                    } else {
                        newTaskText.appendChild(extractedContent);
                    }

                    if (taskText.innerHTML.replace(/\u00A0/g, ' ').trim() === '') {
                        taskText.innerHTML = '&nbsp;';
                    }
                } else {
                    newTaskText.innerHTML = '&nbsp;';
                }

                newTaskRow.appendChild(checkbox);
                newTaskRow.appendChild(newTaskText);
                
                taskRow.after(newTaskRow);

                const newRange = document.createRange();
                newRange.setStart(newTaskText, 0);
                newRange.setEnd(newTaskText, 0);
                selection.removeAllRanges();
                selection.addRange(newRange);

                updateLineNumbers();
                localStorage.setItem(getNoteKey(), notepad.innerHTML);
                return;
            }
        }

        if (event.key === 'Backspace') {
            const targetNode = range.startContainer;
            
            const taskRow = targetNode.nodeType === Node.ELEMENT_NODE 
                ? targetNode.closest('.task-row') 
                : targetNode.parentElement.closest('.task-row');

            if (taskRow) {
                const taskText = taskRow.querySelector('.task-text');
                if (taskText) {
                    const checkRange = range.cloneRange();
                    checkRange.setStart(taskText, 0);
                    checkRange.setEnd(range.startContainer, range.startOffset);
                    
                    const textBeforeCursor = checkRange.toString().replace(/\u00A0/g, ' ').trim();

                    if (textBeforeCursor === '') {
                        event.preventDefault();
                        
                        const plainLine = document.createElement('div');
                        
                        plainLine.innerHTML = (taskText.innerHTML === '&nbsp;' || taskText.innerHTML === '') 
                            ? '<br>' 
                            : taskText.innerHTML;
                        
                        taskRow.replaceWith(plainLine);
                        
                        const newRange = document.createRange();
                        newRange.selectNodeContents(plainLine);
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                        
                        updateLineNumbers();
                        localStorage.setItem(getNoteKey(), notepad.innerHTML);
                    }
                }
            }
        }
    });
}

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
            const parsed = JSON.parse(storedSessions);
            if (Array.isArray(parsed)) {
                // Safely convert legacy string-based sessions to full objects
                sessions = parsed.map(s => {
                    if (typeof s === 'string') {
                        return {
                            name: s,
                            workTime: DEFAULT_WORK_DURATION,
                            breakTime: DEFAULT_BREAK_DURATION,
                            focusGenre: "lofi",
                            breakGenre: "jazz"
                        };
                    }
                    return s;
                });
            }
        } catch (e) {
            sessions = [];
        }
    }
    if (!Array.isArray(sessions) || sessions.length === 0) {
        sessions = [{ 
            name: "Ma première Session", 
            workTime: DEFAULT_WORK_DURATION, 
            breakTime: DEFAULT_BREAK_DURATION,
            focusGenre: "lofi",
            breakGenre: "jazz"
        }];
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
        const sessionName = (typeof session === 'object' && session !== null) ? session.name : session;
        if (!sessionName) return;

        const sessionItem = document.createElement('div');
        sessionItem.classList.add('session-item');
        
        if (sessionName === activeSessionName) {
            sessionItem.classList.add('active');
        }

        sessionItem.setAttribute('draggable', 'true');
        
        sessionItem.addEventListener('dragstart', (e) => {
            // Indique à WebView2 qu'il s'agit d'une copie
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', sessionName);
            sessionItem.style.opacity = '0.5'; 
        });

        sessionItem.addEventListener('dragend', () => {
            sessionItem.style.opacity = '1'; 
        });
        
        sessionItem.textContent = `- ${sessionName}`;
        sessionItem.addEventListener('click', () => selectSession(sessionName));

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
    renderFlowList();
    updateDisplay();
}

function getActiveSession() {
    return sessions.find(s => s.name === activeSessionName) || sessions[0];
}

//================================
//        Gestion des flows
//================================

function initFlowDragAndDrop() {
    const flowListContainer = document.getElementById('flow-list');
    const clearFlowBtn = document.getElementById('clear-flow-btn');

    if (!flowListContainer) return;

    // ==========================================
    // 1. Drop zone : Ajouter une session au Flow
    // ==========================================
    flowListContainer.addEventListener('dragenter', (e) => {
        e.preventDefault();
        flowListContainer.classList.add('drag-over');
    });

    flowListContainer.addEventListener('dragover', (e) => {
        e.preventDefault(); // Authorizes drop in WebView2
        e.dataTransfer.dropEffect = 'copy';
    });

    flowListContainer.addEventListener('dragleave', () => {
        flowListContainer.classList.remove('drag-over');
    });

    flowListContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        flowListContainer.classList.remove('drag-over');

        const sessionName = e.dataTransfer.getData('text/plain');
        if (sessionName) {
            addSessionToFlow(sessionName);
        }
    });

    // ==========================================
    // 2. Delete zone : Supprimer un élément du Flow
    // ==========================================
    if (clearFlowBtn) {
        clearFlowBtn.addEventListener('dragenter', (e) => {
            e.preventDefault();
            clearFlowBtn.classList.add('trash-hover');
        });

        clearFlowBtn.addEventListener('dragover', (e) => {
            e.preventDefault(); // Authorizes drop in WebView2
            e.dataTransfer.dropEffect = 'move';
        });

        clearFlowBtn.addEventListener('dragleave', () => {
            clearFlowBtn.classList.remove('trash-hover');
        });

        clearFlowBtn.addEventListener('drop', (e) => {
            e.preventDefault();
            clearFlowBtn.classList.remove('trash-hover');

            // Retrieve stored index from flow element
            const flowIndex = e.dataTransfer.getData('text/flow-index') || e.dataTransfer.getData('text/plain');

            if (flowIndex !== null && flowIndex !== '') {
                const index = parseInt(flowIndex, 10);
                if (!isNaN(index) && index >= 0 && index < flowQueue.length) {
                    flowQueue.splice(index, 1);
                    renderFlowList();
                    if (typeof showNotification === 'function') {
                        showNotification("🗑️ Session retirée du Flow.");
                    }
                }
            }
        });
    }
}

function addSessionToFlow(sessionName) {
    const sessionExists = sessions.some(s => {
        const name = (typeof s === 'object' && s !== null) ? s.name : s;
        return name && name.trim() === sessionName;
    });
    
    if (!sessionExists) {
        console.warn(`La session "${sessionName}" n'existe pas dans la liste des sessions.`);
        return;
    }

    flowQueue.push(sessionName);
    renderFlowList();
}

function renderFlowList() {
    const flowListContainer = document.getElementById('flow-list');
    const currentFlowSessionElem = document.getElementById('current-flow-session');
    
    if (!flowListContainer) return;

    if (currentFlowSessionElem) {
        const sessionName = activeSessionName ? activeSessionName : "Aucune";
        currentFlowSessionElem.textContent = sessionName;
        currentFlowSessionElem.classList.remove('is-scrolling');
        
        setTimeout(() => {
            const wrapper = document.getElementById('current-flow-wrapper');
            if (wrapper && currentFlowSessionElem.scrollWidth > wrapper.clientWidth) {
                currentFlowSessionElem.textContent = `${sessionName} \u00A0\u00A0\u00A0\u00A0 ${sessionName} \u00A0\u00A0\u00A0\u00A0`;
                currentFlowSessionElem.classList.add('is-scrolling');
            }
        }, 50);
    }

    flowListContainer.innerHTML = '';

    if (flowQueue.length === 0) {
        flowListContainer.innerHTML = `<div class="flow-empty-placeholder">Glissez vos sessions ici pour créer un enchaînement...</div>`;
        return;
    }

    flowQueue.forEach((sessionName, index) => {
        if (index > 0) {
            const chainConnector = document.createElement('div');
            chainConnector.classList.add('flow-chain-connector');
            chainConnector.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
            `;
            flowListContainer.appendChild(chainConnector);
        }

        const flowItem = document.createElement('div');
        flowItem.classList.add('flow-item');
        flowItem.textContent = `${index + 1}. ${sessionName}`;
        
        flowItem.setAttribute('draggable', 'true');
        flowItem.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/flow-index', String(index));
            e.dataTransfer.setData('text/plain', String(index));
            e.dataTransfer.effectAllowed = 'move';
            flowItem.style.opacity = '0.4';
        });
        flowItem.addEventListener('dragend', () => {
            flowItem.style.opacity = '1';
        });

        flowListContainer.appendChild(flowItem);
    });
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

    if (creationFocusSelect) creationFocusSelect.value = 'lofi';
    if (creationBreakSelect) creationBreakSelect.value = 'jazz';

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

    const focusGenre = creationFocusSelect ? creationFocusSelect.value : 'lofi';
    const breakGenre = creationBreakSelect ? creationBreakSelect.value : 'jazz';

    sessions.push({
        name: name,
        workTime: workMinutes * 60,
        breakTime: breakMinutes * 60,
        focusGenre: focusGenre,
        breakGenre: breakGenre
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
    if (settingsFocusSelect) settingsFocusSelect.value = currentSession.focusGenre || 'lofi';
    if (settingsBreakSelect) settingsBreakSelect.value = currentSession.breakGenre || 'jazz';

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
    
    const oldWorkTime   = currentSession.workTime;
    const oldBreakTime  = currentSession.breakTime;
    const oldFocusGenre = currentSession.focusGenre;
    const oldBreakGenre = currentSession.breakGenre;

    currentSession.name = newName;
    if (workInput && workInput.value) currentSession.workTime = parseInt(workInput.value, 10) * 60;
    if (breakInput && breakInput.value) currentSession.breakTime = parseInt(breakInput.value, 10) * 60;
    if (settingsFocusSelect) currentSession.focusGenre = settingsFocusSelect.value;
    if (settingsBreakSelect) currentSession.breakGenre = settingsBreakSelect.value;

    activeSessionName = newName;

    const newNoteKey = getNoteKey();
    if (currentNotes !== null && oldNoteKey !== newNoteKey) {
        localStorage.setItem(newNoteKey, currentNotes);
        localStorage.removeItem(oldNoteKey);
    }

    saveSessionsToStorage();
    renderSessionsList();
    
    const durationChanged = (currentMode === 'focus' && currentSession.workTime !== oldWorkTime) ||
                            (currentMode === 'pause' && currentSession.breakTime !== oldBreakTime);

    if (durationChanged) {
        pauseTimer();
        timeLeft = currentMode === 'focus' ? currentSession.workTime : currentSession.breakTime; 
        updateDisplay();
    }

    const genreChanged = (currentMode === 'focus' && currentSession.focusGenre !== oldFocusGenre) ||
                         (currentMode === 'pause' && currentSession.breakGenre !== oldBreakGenre);

    if (genreChanged) {
        console.log(`[Parameters] Genre changed mid-session. Refreshing stream for mode: ${currentMode}`);
        fetchAndPlayBackgroundMusic(currentMode, "refresh");
    }

    updateDisplay();
    closeParameterModal();
    showNotification("✏️ Paramètres mis à jour !");
}

//================================
//  Auto-Update Checker Logic
//================================

const GITHUB_REPOSITORY = 'M1chigan/TomatoFlow'; 

async function checkLatestRelease() {
    const banner = document.getElementById('update-banner');
    const closeBtn = document.getElementById('close-update-banner');

    if (!banner || !closeBtn) return;

    closeBtn.addEventListener('click', () => {
        banner.classList.add('hidden');
    });

    try {
        const currentVersion = await getVersion();

        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`);
        if (!response.ok) return;

        const data = await response.json();
        const latestVersion = data.tag_name.replace('v', '').trim();

        if (latestVersion !== currentVersion) {
            banner.classList.remove('hidden');
        }
    } catch (error) {
        console.error("Failed to check for updates via GitHub API:", error);
    }
}

//================================
//  TAURI Integration
//================================

async function initTauriIntegration() {
    try {
        tauriStore = await load('preferences.json', { autoSave: true });

        const savedVolume = await tauriStore.get('volume');
        if (savedVolume !== null && savedVolume !== undefined) {
            if (volumeSlider) volumeSlider.value = savedVolume;
            if (currentAudio) currentAudio.volume = savedVolume;
            if (volumeIcon) {
                volumeIcon.textContent = savedVolume == 0 ? "🔇" : (savedVolume < 0.4 ? "🔈" : "🔊");
            }
        }

        // Global shortcuts wrapped in try-catch to prevent crash on reloads
        try {
            await register('CommandOrControl+Shift+M', () => toggleMute());
        } catch (e) {
            console.warn("Shortcut Ctrl+Shift+M already registered or ignored on reload:", e);
        }

        try {
            await register('CommandOrControl+Shift+Right', () => {
                fetchAndPlayBackgroundMusic(currentMode, "refresh");
            });
        } catch (e) {
            console.warn("Shortcut Ctrl+Shift+Right already registered or ignored on reload:", e);
        }

        await listen('tray-toggle-mute', () => toggleMute());

        console.log("LOG [Tauri]: Store, global shortcuts and tray listener initialized.");
    } catch (error) {
        console.error("LOG [Tauri Init Error]:", error);
    }
}

//================================
//  Initialization & Event Listeners
//================================

document.addEventListener('DOMContentLoaded', () => {
    
    // Initialization 
    loadSessionsFromStorage();
    renderSessionsList();
    updateDisplay();
    window.switchSessionNotes();
    initDefaultStation(currentMode);
    checkLatestRelease();
    initFlowDragAndDrop();
    renderFlowList();
    initTauriIntegration();

    // Event Listeners
    if (startBtn) startBtn.addEventListener('click', startTimer);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log("LOG [UI]: Refresh button triggered.");
            fetchAndPlayBackgroundMusic(currentMode, "refresh");
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const volumeValue = e.target.value;
            
            if (currentAudio) {
                currentAudio.volume = volumeValue;
            }

            if (tauriStore) {
                tauriStore.set('volume', parseFloat(volumeValue));
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

    if (settingsFocusSelect) {
        settingsFocusSelect.addEventListener('change', (e) => {
            const currentSession = getActiveSession();
            currentSession.focusGenre = e.target.value;
            saveSessionsToStorage();
            if (currentMode === 'focus') {
                fetchAndPlayBackgroundMusic('focus', 'refresh');
            }
        });
    }

    if (settingsBreakSelect) {
        settingsBreakSelect.addEventListener('change', (e) => {
            const currentSession = getActiveSession();
            currentSession.breakGenre = e.target.value;
            saveSessionsToStorage();
            if (currentMode === 'pause') {
                fetchAndPlayBackgroundMusic('pause', 'refresh');
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
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());