// Game logic module for WordWeft web client
const Game = (() => {
    let profanitySet = new Set();
    let reservedNames = new Set();
    // Load profanity + reserved-names lists
    fetch('profanity.json').then(r => r.json()).then(list => {
        list.forEach(w => profanitySet.add(w.toLowerCase()));
    }).catch(() => {});
    fetch('reserved_names.json').then(r => r.json()).then(list => {
        list.forEach(w => reservedNames.add(w.toLowerCase()));
    }).catch(() => {});

    // Gameplay filter: word-boundary match, no leetspeak (avoids false
    // positives in prose like "the assassin" or "scunthorpe").
    function containsProfanity(text) {
        if (profanitySet.size === 0) return false;
        return text.toLowerCase().split(/\s+/).some(w => profanitySet.has(w.replace(/[^a-z]/g, '')));
    }

    // Leetspeak normalization — map common digit/symbol substitutions back
    // to letters so "5h1t" / "fuk" / "@ssh0le" match the list.
    const LEET_MAP = { '0':'o','1':'i','|':'i','3':'e','4':'a','@':'a','5':'s','$':'s','7':'t','+':'t','8':'b','9':'g' };
    function deleet(s) {
        let out = '';
        for (const c of s) out += (LEET_MAP[c] || c);
        return out;
    }
    function normalizeUsername(name) {
        return deleet(name.toLowerCase()).replace(/[^a-z]/g, '');
    }

    function isReservedUsername(name) {
        if (reservedNames.size === 0) return false;
        const norm = normalizeUsername(name);
        if (!norm) return false;
        if (reservedNames.has(norm)) return true;
        for (const r of reservedNames) {
            if (r.length >= 3 && norm.startsWith(r)) return true;
        }
        return false;
    }

    // Tiered username match. 3-letter bad words require a whole-token
    // equality match (so "ike" doesn't nuke "Mikeixel" or "Mike"); 4-letter
    // matches need exact or prefix; 5+ is free substring.
    function containsProfanityInUsername(name) {
        if (profanitySet.size === 0) return false;
        const whole = normalizeUsername(name);
        if (!whole) return false;
        const tokens = (name || '').toLowerCase()
            .split(/[^a-z0-9]+/)
            .map(t => deleet(t).replace(/[^a-z]/g, ''))
            .filter(Boolean);
        for (const w of profanitySet) {
            if (w.length < 3) continue;
            if (w.length === 3) {
                if (whole === w) return true;
                if (tokens.some(t => t === w)) return true;
            } else if (w.length === 4) {
                if (whole === w || whole.startsWith(w)) return true;
                if (tokens.some(t => t === w || t.startsWith(w))) return true;
            } else {
                if (whole.indexOf(w) >= 0) return true;
                if (tokens.some(t => t.indexOf(w) >= 0)) return true;
            }
        }
        return false;
    }

    /**
     * Combined username gate. Returns null if OK, or a user-facing reason
     * string if rejected.
     */
    function rejectUsername(name) {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        if (isReservedUsername(trimmed)) return "That name is reserved \u2014 please pick another.";
        if (containsProfanityInUsername(trimmed)) return "Let's keep it clean! Please pick a different name.";
        return null;
    }

    let players = [];
    let words = [];
    let currentPlayerIndex = 0;
    let turnWordCount = 0;
    let turnWordsNeeded = 1;
    let gameMode = 'ONE_WORD';
    let turnTimerSeconds = 0;
    let timerInterval = null;
    let timerRemaining = 0;
    let hasVotedToFinish = false;
    let finishVoteCount = 0;
    let hasVotedToExtend = false;
    let extensionGrantedThisTurn = false;
    let lastExtensionGranted = 0;
    let disconnectedIds = [];
    let timerStartedAt = 0;
    let isPaused = false;
    let pauseSecondsRemaining = 0;
    let pauseInterval = null;

    // Player color hex values for display
    const COLOR_MAP = {
        [0xFF6366F1]: '#6366F1', // Indigo
        [0xFFEC4899]: '#EC4899', // Pink
        [0xFF10B981]: '#10B981', // Emerald
        [0xFFF59E0B]: '#F59E0B', // Amber
        [0xFF8B5CF6]: '#8B5CF6', // Violet
        [0xFF06B6D4]: '#06B6D4', // Cyan
        [0xFFEF4444]: '#EF4444', // Red
        [0xFF84CC16]: '#84CC16'  // Lime
    };

    function getPlayerColor(colorValue) {
        return COLOR_MAP[colorValue] || '#A0A0B8';
    }

    // Light stemmer so "marshmallows" still satisfies a "marshmallow" secret.
    // Handles regular -s, -es, and -ies plurals; both directions because
    // submit-or-secret could be either form.
    function stemForSecret(word) {
        const w = (word || '').toLowerCase().replace(/[^a-z]/g, '');
        if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
        if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
        if (w.length > 2 && w.endsWith('s')) return w.slice(0, -1);
        return w;
    }

    function startListening() {
        // Players
        Room.listen('players', (snap) => {
            const data = snap.val();
            if (!data) return;
            players = [];
            Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b)).forEach((key) => {
                const p = data[key];
                players.push({
                    id: parseInt(key),
                    name: p.name,
                    color: p.color,
                    avatar: p.avatar || '',
                    isHost: p.isHost || false,
                    isConnected: p.isConnected !== false,
                    uid: p.uid
                });
            });
            // Derive disconnected list from isConnected field
            disconnectedIds = players.filter(p => !p.isConnected).map(p => p.id);
            updatePlayerList();
            updateLobbyPlayers();
            updateTurnIndicator();
            // Vote thresholds depend on connected count, so recompute when
            // connection set changes (e.g. someone leaves mid-vote).
            if (typeof recomputeFinishVotes === 'function') recomputeFinishVotes();
            if (typeof recomputeExtensionVotes === 'function') recomputeExtensionVotes();

            // Auto-promote host if host disconnected
            const host = players.find(p => p.isHost);
            const hostDisconnected = host && disconnectedIds.includes(host.id);
            if (hostDisconnected && Room.ref) {
                // Lowest-index connected player becomes new host
                const newHost = players.find(p => p.isConnected);
                if (newHost && newHost.id === Room.myIndex) {
                    Room.ref.child('players/' + host.id + '/isHost').set(false);
                    Room.ref.child('players/' + newHost.id + '/isHost').set(true);
                    Room.ref.child('meta/hostId').set(newHost.uid);
                }
            }
            showHostMigration(hostDisconnected);

            // Handle disconnected player's turn
            const lowestConnected = players.find(p => p.isConnected);
            if (lowestConnected && lowestConnected.id === Room.myIndex && players.length > 1) {
                const currentPlayer = players[currentPlayerIndex];
                if (currentPlayer && !currentPlayer.isConnected) {
                    const connectedCount = players.filter(p => p.isConnected).length;
                    if (players.length === 2 && connectedCount === 1) {
                        // 2-player game: pause instead of skip
                        if (!isPaused) {
                            Room.pauseGame();
                        }
                    } else {
                        // 3+ players: auto-skip as before
                        const nextIndex = (currentPlayerIndex + 1) % players.length;
                        Room.advanceTurn(nextIndex, getWordsNeeded() || 1);
                    }
                }
            }
        });

        // Words
        Room.listen('words', (snap) => {
            const data = snap.val();
            const oldLength = words.length;
            words = [];
            if (data) {
                Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b)).forEach((key) => {
                    const w = data[key];
                    words.push({
                        word: w.word,
                        playerId: w.playerId,
                        position: w.position
                    });
                });
            }
            renderStory(oldLength);
            // Show finish button only after 5+ words
            const finishBtn = document.getElementById('btn-vote-finish');
            if (finishBtn) finishBtn.classList.toggle('hidden', words.length < 5);
        });

        // Turn state
        Room.listen('turn', (snap) => {
            const data = snap.val();
            if (!data) return;
            const oldIndex = currentPlayerIndex;
            currentPlayerIndex = data.currentPlayerIndex || 0;
            turnWordCount = data.turnWordCount || 0;
            turnWordsNeeded = data.turnWordsNeeded || 1;
            timerStartedAt = data.timerStartedAt || 0;
            updateTurnIndicator();
            updateInputState();

            // Auto-skip if turn landed on a disconnected player (lowest connected acts)
            // Don't skip when paused (2-player game waiting for reconnect)
            if (!isPaused) {
                const lowestConn = players.find(p => p.isConnected);
                if (lowestConn && lowestConn.id === Room.myIndex && players.length > 1) {
                    const currentPlayer = players[currentPlayerIndex];
                    if (currentPlayer && !currentPlayer.isConnected) {
                        const nextIndex = (currentPlayerIndex + 1) % players.length;
                        setTimeout(() => Room.advanceTurn(nextIndex, getWordsNeeded() || 1), 300);
                        return;
                    }
                }
            }

            // Reset timer on turn change
            if (oldIndex !== currentPlayerIndex) {
                if (typeof Sound !== 'undefined') Sound.playTurnChange();
                hasVotedToExtend = false;
                extensionGrantedThisTurn = false;
                // Active player just changed → extension eligibility shifts.
                if (typeof recomputeExtensionVotes === 'function') recomputeExtensionVotes();

                // Waiting-for-turn music: play when it's NOT my turn, stop when it IS
                const isMyTurn = currentPlayerIndex === Room.myIndex;
                if (typeof Sound !== 'undefined') {
                    if (isMyTurn) {
                        Sound.stopMusic();
                    } else if (typeof App !== 'undefined') {
                        Sound.startMusic(App.selectedWaitingMusic || App.selectedMusicStyle || 'jazz');
                    }
                }
            }
            // (Re)start the timer on every turn snapshot. This handles the
            // initial-load case where oldIndex === currentPlayerIndex (both 0)
            // and the case where timerStartedAt advances mid-turn (extensions).
            if (turnTimerSeconds > 0 && timerStartedAt > 0) startTimer();
            // Show +30s button for non-active players when timer is on (hide if already extended this turn)
            const extendBtn = document.getElementById('btn-time-extend');
            if (extendBtn) {
                const isMyTurn = currentPlayerIndex === Room.myIndex;
                extendBtn.classList.toggle('hidden', isMyTurn || turnTimerSeconds <= 0 || extensionGrantedThisTurn);
            }
        });

        // Game started
        Room.listen('meta/isStarted', (snap) => {
            if (snap.val() === true) {
                if (typeof Sound !== 'undefined') Sound.stopMusic();
                App.showScreen('game');
            }
        });

        // Game mode
        Room.listen('meta/gameMode', (snap) => {
            gameMode = snap.val() || 'ONE_WORD';
            const modeLabel = document.getElementById('game-mode-label');
            const labels = {
                'ONE_WORD': '1 Word',
                'THREE_WORDS': '3 Words',
                'FIVE_WORDS': '5 Words',
                'SENTENCE': 'Sentence',
                'CUSTOM': 'Custom'
            };
            if (modeLabel) modeLabel.textContent = labels[gameMode] || gameMode;
        });

        // Timer
        Room.listen('meta/turnTimerSeconds', (snap) => {
            turnTimerSeconds = snap.val() || 0;
            // If this loads after the turn snapshot, the timer wouldn't have
            // started yet — kick it off now if a turn is already in progress.
            if (turnTimerSeconds > 0 && timerStartedAt > 0) startTimer();
        });

        // Pause state (2-player disconnect)
        Room.listen('meta/isPaused', (snap) => {
            isPaused = snap.val() === true;
            if (isPaused) {
                startPauseCountdown();
            } else {
                clearPauseCountdown();
            }
            updatePauseBanner();
        });

        // Finish votes — only count votes from currently-connected players,
        // and use the connected count as the denominator. Otherwise a
        // disconnected player can't vote and the threshold is unreachable.
        let lastFinishVoters = {};
        function recomputeFinishVotes() {
            const connectedIds = players.filter(p => p.isConnected).map(p => p.id);
            const connectedSet = new Set(connectedIds);
            const effective = Object.keys(lastFinishVoters)
                .map(Number)
                .filter(id => connectedSet.has(id)).length;
            const denom = connectedIds.length;
            finishVoteCount = effective;
            const voteEl = document.getElementById('vote-count');
            if (voteEl) {
                voteEl.textContent = effective > 0 ? '(' + effective + '/' + denom + ')' : '';
            }
            if (effective >= denom && denom > 0) {
                finishGame();
            }
        }
        Room.listen('votes/finish', (snap) => {
            lastFinishVoters = snap.val() || {};
            recomputeFinishVotes();
        });

        // Time extension votes — eligibility excludes disconnected players
        // and the active turn player.
        let lastExtensionVoters = {};
        function recomputeExtensionVotes() {
            const eligibleIds = players
                .filter(p => p.isConnected && p.id !== currentPlayerIndex)
                .map(p => p.id);
            const eligibleSet = new Set(eligibleIds);
            const eligible = eligibleIds.length;
            const votes = Object.keys(lastExtensionVoters)
                .map(Number)
                .filter(id => eligibleSet.has(id)).length;
            const el = document.getElementById('extend-vote-count');
            if (el) el.textContent = votes > 0 ? '(' + votes + '/' + eligible + ')' : '';
            if (eligible > 0 && votes > eligible / 2) {
                // Lowest-index connected player processes the extension
                const lc = players.find(p => p.isConnected);
                if (lc && lc.id === Room.myIndex) {
                    if (Room.ref) {
                        Room.ref.child('meta/timeExtensionVotes').remove();
                        Room.ref.child('meta/timeExtensionGranted').once('value', (s) => {
                            Room.ref.child('meta/timeExtensionGranted').set((s.val() || 0) + 1);
                        });
                    }
                }
            }
        }
        Room.listen('meta/timeExtensionVotes', (snap) => {
            lastExtensionVoters = snap.val() || {};
            recomputeExtensionVotes();
        });

        // All clients listen for granted extensions (max one per turn)
        Room.listen('meta/timeExtensionGranted', (snap) => {
            const count = snap.val() || 0;
            if (count > lastExtensionGranted) {
                hasVotedToExtend = false;
                extensionGrantedThisTurn = true;
                // Hide the +30s button after one extension per turn
                const extendBtn = document.getElementById('btn-time-extend');
                if (extendBtn) extendBtn.classList.add('hidden');
            }
            lastExtensionGranted = count;
        });

        document.getElementById('btn-time-extend').addEventListener('click', () => {
            if (hasVotedToExtend || extensionGrantedThisTurn || !Room.ref) return;
            hasVotedToExtend = true;
            Room.ref.child('meta/timeExtensionVotes/' + Room.myIndex).set(true);
        });

        // Typing indicators
        Room.listen('typing', (snap) => {
            const data = snap.val();
            const indicator = document.getElementById('typing-indicator');
            const nameEl = document.getElementById('typing-name');
            if (!data || Object.keys(data).length === 0) {
                indicator.classList.add('hidden');
                return;
            }
            const typingIds = Object.keys(data).map(Number).filter(id => id !== Room.myIndex);
            if (typingIds.length === 0) {
                indicator.classList.add('hidden');
                return;
            }
            const typingNames = typingIds.map(id => {
                const p = players.find(pl => pl.id === id);
                return p ? p.name : '?';
            });
            indicator.classList.remove('hidden');
            nameEl.textContent = typingNames.join(', ') + ' typing...';
        });

        // Hidden objectives
        let previousObjectives = {};
        let secretRevealed = false;
        let mySecretWord = '';
        Room.listen('objectives', (snap) => {
            const data = snap.val();
            const area = document.getElementById('secret-word-area');
            const wordEl = document.getElementById('secret-word');
            const statusEl = document.getElementById('secret-status');
            if (!data) {
                area.classList.add('hidden');
                return;
            }
            // Find my objective
            const myObj = data[Room.myIndex];
            if (myObj && myObj.secretWord) {
                area.classList.remove('hidden');
                mySecretWord = myObj.secretWord;
                if (myObj.completed && myObj.busted) {
                    wordEl.textContent = myObj.secretWord;
                    wordEl.style.textDecoration = 'line-through';
                    wordEl.style.opacity = '0.5';
                    statusEl.textContent = 'BUSTED!';
                    statusEl.style.color = '#EF4444';
                    secretRevealed = true;
                } else if (myObj.completed) {
                    wordEl.textContent = myObj.secretWord;
                    wordEl.style.textDecoration = 'line-through';
                    wordEl.style.opacity = '0.5';
                    statusEl.textContent = 'COMPLETE!';
                    statusEl.style.color = '#10B981';
                    secretRevealed = true;
                } else if (secretRevealed) {
                    wordEl.textContent = myObj.secretWord;
                    wordEl.style.textDecoration = 'none';
                    wordEl.style.opacity = '1';
                    statusEl.textContent = '';
                } else {
                    wordEl.textContent = 'Tap to reveal';
                    wordEl.style.textDecoration = 'none';
                    wordEl.style.opacity = '1';
                    statusEl.textContent = '';
                }
            }

            // Check for newly completed/busted objectives (notifications)
            Object.entries(data).forEach(([idx, obj]) => {
                const prevObj = previousObjectives[idx];
                const playerIdx = parseInt(idx);
                const player = players[playerIdx];

                // Bust notification — someone guessed a player's word
                if (obj.busted && (!prevObj || !prevObj.busted)) {
                    if (playerIdx === Room.myIndex) {
                        // I got busted!
                        const buster = obj.bustedBy !== undefined ? players[obj.bustedBy] : null;
                        const busterName = buster ? buster.name : 'Someone';
                        showBustedBanner(busterName + ' guessed your secret word: "' + (obj.secretWord || '???') + '"!');
                    } else if (player) {
                        // Another player got busted
                        const buster = obj.bustedBy !== undefined ? players[obj.bustedBy] : null;
                        const busterName = buster ? buster.name : 'Someone';
                        showToast(busterName + ' busted ' + player.name + "'s secret word!", '#EF4444');
                    }
                }
                // Completion notification (not busted — player used their own word)
                else if (obj.completed && !obj.busted && (!prevObj || !prevObj.completed)) {
                    if (playerIdx === Room.myIndex) {
                        // I snuck in my own secret word!
                        showToast('You snuck in your secret word: "' + (obj.secretWord || '???') + '"!', '#10B981');
                    } else if (player) {
                        showObjectiveNotification(player, obj.secretWord || '???');
                    }
                }

                // Wrong guess notification
                if (obj.wrongGuessBy !== undefined && (!prevObj || prevObj.wrongGuessBy !== obj.wrongGuessBy)) {
                    const guesser = players[obj.wrongGuessBy];
                    const target = players[playerIdx];
                    if (guesser && target) {
                        showToast(guesser.name + ' guessed wrong on ' + target.name + "'s word!", '#F59E0B');
                    }
                }
            });
            previousObjectives = JSON.parse(JSON.stringify(data));
        });

        // Tap-to-reveal secret word
        document.getElementById('secret-word-row').addEventListener('click', () => {
            if (!secretRevealed && mySecretWord) {
                secretRevealed = true;
                document.getElementById('secret-word').textContent = mySecretWord;
            }
        });

        // Load my guesses from Firebase (persists across reconnect)
        Room.listen('guesses/' + Room.myIndex, (snap) => {
            guessedPlayerIds.clear();
            if (snap.val()) {
                Object.keys(snap.val()).forEach(k => guessedPlayerIds.add(Number(k)));
            }
        });

        // Guess word button
        document.getElementById('btn-guess-word').addEventListener('click', openGuessModal);
        document.getElementById('btn-close-guess').addEventListener('click', () => {
            document.getElementById('guess-modal').classList.add('hidden');
        });
        document.getElementById('btn-submit-guess').addEventListener('click', submitGuess);

        // Result
        Room.listen('result', (snap) => {
            const data = snap.val();
            if (!data) return;
            if (timerInterval) clearInterval(timerInterval);
            Room.clearActiveRoom(); // Game over — don't prompt to rejoin
            Results.show(data, { players, words, getPlayerColor });
        });
    }

    function updateLobbyPlayers() {
        const list = document.getElementById('player-list');
        const count = document.getElementById('player-count');
        if (!list) return;

        list.innerHTML = '';
        players.forEach(p => {
            const item = document.createElement('div');
            item.className = 'player-item';
            const pColor = getPlayerColor(p.color);
            item.innerHTML = `
                <span class="player-item-avatar" style="background: ${pColor}33; border: 1.5px solid ${pColor}">${p.avatar || '\u{1F60A}'}</span>
                <span class="player-item-name" style="color: ${pColor}">${p.name}</span>
                ${p.isHost ? '<span class="player-item-host">Host</span>' : ''}
            `;
            list.appendChild(item);
        });
        if (count) count.textContent = '(' + players.length + '/8)';

        // Enable start button for host with 2+ players
        const startBtn = document.getElementById('btn-start-game');
        if (startBtn) {
            startBtn.disabled = players.length < 2;
        }
    }

    function updatePlayerList() {
        // Update for game screen if needed
    }

    function renderStory(oldLength) {
        const textEl = document.getElementById('story-text');
        if (!textEl) return;

        // Preserve viewport position on mobile
        const scrollY = window.scrollY;

        if (words.length === 0) {
            textEl.innerHTML = '<span class="story-placeholder">' + getEmptyStoryText() + '</span>';
            return;
        }

        textEl.innerHTML = '';
        words.forEach((w, i) => {
            const span = document.createElement('span');
            span.className = 'story-word';
            const player = players.find(p => p.id === w.playerId);
            if (player) {
                span.style.color = getPlayerColor(player.color);
            } else if (w.playerId === -1) {
                // Prompt word
                span.style.color = '#666680';
                span.style.fontStyle = 'italic';
            }
            span.textContent = (i > 0 ? ' ' : '') + w.word;
            if (i >= oldLength) {
                span.classList.add('new');
            }
            textEl.appendChild(span);
        });

        if (currentPlayerIndex === Room.myIndex) {
            const cursor = document.createElement('span');
            cursor.className = 'story-cursor';
            const myPlayer = players[Room.myIndex];
            if (myPlayer) cursor.style.background = getPlayerColor(myPlayer.color);
            textEl.appendChild(cursor);
        }

        // Auto-scroll story area to bottom, restore viewport
        const storyArea = document.getElementById('story-area');
        if (storyArea) {
            storyArea.scrollTop = storyArea.scrollHeight;
        }
        window.scrollTo(0, scrollY);
    }

    function updateTurnIndicator() {
        const el = document.getElementById('turn-indicator');
        if (!el) return;
        const player = players[currentPlayerIndex];
        if (!player) return;

        const isMyTurn = currentPlayerIndex === Room.myIndex;
        const pColor = getPlayerColor(player.color);
        el.style.background = pColor + '26';
        el.style.borderRadius = '16px';
        el.style.padding = '6px 14px';
        if (isMyTurn) {
            el.innerHTML = '<span class="current-player">Your turn!</span>';
        } else {
            el.innerHTML = '<span style="color:' + pColor + '">' +
                (player.avatar ? player.avatar + ' ' : '') + player.name + '</span>\'s turn';
        }

        // Update player order bar
        const bar = document.getElementById('player-order-bar');
        if (bar && players.length > 0) {
            bar.innerHTML = '';
            players.forEach((p, i) => {
                const chip = document.createElement('div');
                const isDisconnected = disconnectedIds.includes(p.id);
                chip.className = 'player-order-chip' + (i === currentPlayerIndex ? ' active' : '') +
                    (i === Room.myIndex ? ' me' : '') + (isDisconnected ? ' disconnected' : '');
                chip.style.borderColor = getPlayerColor(p.color);
                if (i === currentPlayerIndex) chip.style.background = getPlayerColor(p.color) + '30';
                chip.innerHTML = '<span class="po-avatar">' + (p.avatar || '\u{1F60A}') + '</span>' +
                    '<span class="po-name" style="color:' + getPlayerColor(p.color) + '">' + p.name + '</span>';
                bar.appendChild(chip);
            });
        }
    }

    function updateInputState() {
        const input = document.getElementById('word-input');
        const btn = document.getElementById('btn-submit-word');
        const isMyTurn = currentPlayerIndex === Room.myIndex;

        if (input) {
            input.disabled = !isMyTurn;
            input.placeholder = isMyTurn ? getPlaceholder() : 'Wait for your turn...';
            // Don't auto-focus on mobile — it pops the keyboard and pushes story off-screen.
            // Players can tap the input themselves when they want to type.
        }
        if (btn) btn.disabled = !isMyTurn;
    }

    function getPlaceholder() {
        switch (gameMode) {
            case 'ONE_WORD': return 'Type one word...';
            case 'THREE_WORDS': return 'Type three words...';
            case 'FIVE_WORDS': return 'Type five words...';
            case 'SENTENCE': return 'Type until punctuation...';
            case 'CUSTOM': return 'Type words...';
            default: return 'Type your word...';
        }
    }

    function getEmptyStoryText() {
        switch (gameMode) {
            case 'ONE_WORD': return 'The story begins when someone submits a word...';
            case 'THREE_WORDS': return 'The story begins when someone submits three words...';
            case 'FIVE_WORDS': return 'The story begins when someone submits five words...';
            case 'SENTENCE': return 'The story begins when someone writes a sentence...';
            case 'CUSTOM': return 'The story begins when someone takes their turn...';
            default: return 'The story begins when someone takes their turn...';
        }
    }

    function submitWord(text, forceEndTurn) {
        text = text.trim();
        if (!text) return;
        if (currentPlayerIndex !== Room.myIndex) return;

        const wordsToSubmit = splitWords(text);
        if (!isValidSubmission(wordsToSubmit)) return;

        if (containsProfanity(text)) {
            showToast("Let's keep it clean!", '#EF4444');
            return;
        }

        // Clear typing
        Room.setTyping(Room.myIndex, false);

        // Submit words sequentially to avoid race conditions with Firebase indexes
        (async () => {
            // If input is just punctuation (e.g. "."), append to last word
            const isPunctuationOnly = wordsToSubmit.length === 1 && !/[a-zA-Z]/.test(wordsToSubmit[0]);
            if (isPunctuationOnly && words.length > 0) {
                const lastEntry = words[words.length - 1];
                await Room.ref.child('words/' + lastEntry.position + '/word').set(lastEntry.word + wordsToSubmit[0]);
            } else {
                for (const w of wordsToSubmit) {
                    await Room.submitWord(w, Room.myIndex);
                }
            }
            if (typeof Sound !== 'undefined') Sound.playWordSubmit();

            // Check hidden objective completion
            if (Room.ref) {
                try {
                    const objSnap = await Room.ref.child('objectives/' + Room.myIndex).once('value');
                    const obj = objSnap.val();
                    if (obj && obj.secretWord && !obj.completed) {
                        const target = stemForSecret(obj.secretWord);
                        const submitted = wordsToSubmit.map(stemForSecret);
                        if (submitted.includes(target)) {
                            await Room.ref.child('objectives/' + Room.myIndex + '/completed').set(true);
                        }
                    }
                } catch(e) {}
            }

            const addedCount = isPunctuationOnly ? 0 : wordsToSubmit.length;
            const newCount = turnWordCount + addedCount;
            const needed = getWordsNeeded();

            if (needed && newCount >= needed) {
                // Turn complete for fixed-count modes
                const nextIndex = (currentPlayerIndex + 1) % players.length;
                Room.advanceTurn(nextIndex, needed);
            } else if (gameMode === 'SENTENCE') {
                const lastWord = wordsToSubmit[wordsToSubmit.length - 1];
                const endsSentence = /[.!?]$/.test(lastWord);
                // Advance if the player completed a sentence OR the caller forced
                // end-of-turn (e.g. timer expired mid-sentence — commit whatever
                // they typed and let the next player finish).
                if (endsSentence || forceEndTurn) {
                    const nextIndex = (currentPlayerIndex + 1) % players.length;
                    Room.advanceTurn(nextIndex, 0);
                } else {
                    Room.updateTurnWordCount(newCount);
                }
            } else {
                Room.updateTurnWordCount(newCount);
            }
        })();

        // Clear input
        document.getElementById('word-input').value = '';
    }

    function splitWords(text) {
        const sanitized = text.replace(/[<>{}[\]\\|`~^]/g, '');
        if (gameMode === 'ONE_WORD') {
            const parts = sanitized.split(/[\s,;]+/).filter(w => w.length > 0);
            return parts.length > 0 ? [parts[0]] : [];
        }
        const tokens = sanitized.split(/\s+/).filter(w => w.length > 0);
        if (gameMode !== 'SENTENCE') return tokens;
        // In SENTENCE mode, split tokens so terminal punctuation (.!?) stays
        // attached to the preceding chars but ends the token, then truncate
        // at the first terminal-punct token: "hello.world" -> ["hello."], not
        // ["hello.", "world"]. Punctuation is a hard stop for the turn.
        const result = [];
        for (const tok of tokens) {
            const parts = tok.split(/(?<=[.!?])/);
            for (const p of parts) {
                if (!p) continue;
                result.push(p);
                if (/[.!?]$/.test(p)) return result;
            }
        }
        return result;
    }

    function getWordsNeeded() {
        switch (gameMode) {
            case 'ONE_WORD': return 1;
            case 'THREE_WORDS': return 3;
            case 'FIVE_WORDS': return 5;
            default: return null;
        }
    }

    function isValidSubmission(wordList) {
        if (wordList.length === 0) return false;
        // In sentence mode, allow punctuation-only (e.g. ".") only if player already submitted words this turn
        if (gameMode === 'SENTENCE' && turnWordCount > 0) {
            return wordList.length > 0;
        }
        if (!wordList.some(w => /[a-zA-Z]/.test(w))) return false;
        return true;
    }

    function toggleFinishVote() {
        hasVotedToFinish = !hasVotedToFinish;
        if (hasVotedToFinish) {
            Room.voteFinish(Room.myIndex);
        } else {
            Room.unvoteFinish(Room.myIndex);
        }
        // Update finishTotal so Android host knows the threshold
        if (Room.ref) {
            Room.ref.child('votes/finishTotal').set(players.length);
        }
        const btn = document.getElementById('btn-vote-finish');
        if (btn) {
            btn.style.background = hasVotedToFinish ? 'rgba(16,185,129,0.2)' : 'transparent';
            btn.style.color = hasVotedToFinish ? '#10B981' : 'var(--text-secondary)';
        }
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        if (turnTimerSeconds <= 0) {
            document.getElementById('timer-display').classList.add('hidden');
            return;
        }

        const display = document.getElementById('timer-display');
        display.classList.remove('hidden');
        let hasExpired = false;

        // Compute remaining from server timestamp
        function tick() {
            // Freeze timer while game is paused (2-player disconnect)
            if (isPaused) return;
            if (timerStartedAt > 0) {
                const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
                // extensionGrantedThisTurn is tracked by the granted listener, timerRemaining
                // gets +30 added there, so we just compute base from server time
                const extBonus = extensionGrantedThisTurn ? 30 : 0;
                timerRemaining = Math.max(0, turnTimerSeconds + extBonus - elapsed);
            } else {
                timerRemaining = turnTimerSeconds;
            }

            display.textContent = timerRemaining;
            display.className = 'timer-display' + (timerRemaining <= 5 ? ' urgent' : '');
            if (timerRemaining === 5 && !hasExpired && typeof Sound !== 'undefined') Sound.playTimerWarning();

            if (timerRemaining <= 0 && !hasExpired) {
                hasExpired = true;
                // Active player submits their own text, otherwise lowest connected skips
                if (currentPlayerIndex === Room.myIndex) {
                    const input = document.getElementById('word-input');
                    const text = input ? input.value.trim() : '';
                    if (text) {
                        // forceEndTurn=true so SENTENCE mode advances even
                        // without terminal punctuation — next player picks up.
                        submitWord(text, true);
                    } else {
                        const nextIndex = (currentPlayerIndex + 1) % players.length;
                        Room.advanceTurn(nextIndex, getWordsNeeded() || 1);
                    }
                } else {
                    // If it's someone else's turn and they timed out, lowest connected advances
                    const lc = players.find(p => p.isConnected);
                    if (lc && lc.id === Room.myIndex) {
                        const nextIndex = (currentPlayerIndex + 1) % players.length;
                        Room.advanceTurn(nextIndex, getWordsNeeded() || 1);
                    }
                }
            }
            if (timerRemaining > 0) hasExpired = false;
        }

        tick(); // immediate first tick
        timerInterval = setInterval(tick, 1000);
    }

    // Results rendering is now handled by the Results module (results.js)

    let gameFinished = false;

    async function finishGame() {
        if (gameFinished) return;
        gameFinished = true;
        if (timerInterval) clearInterval(timerInterval);
        Room.clearActiveRoom(); // Game over

        // Ensure the CEFR word dictionary is loaded so misspellings can be
        // filtered out of rarest/longest-word picks. Fetch started at page
        // load, so usually this resolves instantly.
        if (typeof WordRarity !== 'undefined' && WordRarity.load) {
            try { await WordRarity.load(); } catch (_) {}
        }

        // Build the full story from words
        const storyWords = words.map(w => w.word);
        let fullStory = '';
        storyWords.forEach((w, i) => {
            // Capitalize after sentence-ending punctuation or at start
            if (i === 0 || (i > 0 && /[.!?]$/.test(storyWords[i - 1]))) {
                w = w.charAt(0).toUpperCase() + w.slice(1);
            }
            fullStory += (i > 0 ? ' ' : '') + w;
        });
        // Ensure story ends with punctuation
        if (fullStory && !/[.!?]$/.test(fullStory)) fullStory += '.';

        // Per-player word stats are just facts (counts, longest word,
        // etc.) — computed locally since they don't need an LLM. The
        // judged scores (coherence, creativity, humor, grade, genre,
        // mood, tags) MUST come from the Cloud Function. No heuristic
        // fallback — if LLM fails, the results screen shows an error.
        const playerStats = players.map(p => {
            const pWords = words.filter(w => w.playerId === p.id);
            const pWordTexts = pWords.map(w => w.word);
            const pUnique = new Set(pWordTexts.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
            const avgLen = pWordTexts.length > 0 ?
                (pWordTexts.reduce((sum, w) => sum + w.replace(/[^a-z]/gi, '').length, 0) / pWordTexts.length).toFixed(1) : 0;
            const longest = pWordTexts.reduce((l, w) => w.replace(/[^a-z]/gi, '').length > l.length ? w : l, '');
            return {
                playerName: p.name,
                playerAvatar: p.avatar || '\u{1F60A}',
                wordCount: pWordTexts.length,
                uniqueWords: pUnique.size,
                avgWordLength: avgLen,
                longestWord: longest,
                bestWord: longest,
            };
        });
        const seed = { fullStory, playerStats, totalWords: storyWords.length };

        const me = players.find(p => p.id === Room.myIndex);
        const amHost = me && me.isHost;
        console.log('finishGame: myIndex=' + Room.myIndex +
            ', amHost=' + amHost + ', players=' + players.length);
        if (!amHost) {
            console.log('finishGame: not host → waiting for host to post result');
            return;
        }
        const merged = await tryGradeStory(seed, players, words);
        if (merged) {
            console.log('finishGame: LLM grade received → posting');
            Room.postResult(merged);
        } else {
            console.warn('finishGame: LLM grading FAILED — posting error state');
            Room.postResult({
                ...seed,
                gradingError: 'LLM grading is unavailable. Deploy `gradeStory` and/or check Functions logs.',
            });
        }
    }

    /**
     * Call the gradeStory Cloud Function and merge its response over the
     * heuristic result. Returns null if the call fails so the caller can
     * post the heuristic as-is.
     */
    async function tryGradeStory(heuristic, players, words) {
        if (!fbFunctions || typeof fbFunctions.httpsCallable !== 'function') {
            console.warn('gradeStory skipped — fbFunctions unavailable', {
                fbFunctions,
                firebaseFunctions: typeof firebase !== 'undefined' ? firebase.functions : 'firebase-undefined',
            });
            return null;
        }
        console.log('gradeStory: calling Cloud Function (host=' +
            (players.find(p => p.id === Room.myIndex)?.isHost) +
            ', words=' + words.length + ')');
        try {
            const playerById = {};
            players.forEach(p => { playerById[p.id] = p; });
            const attributed = words
                .filter(w => w.playerId >= 0)
                .map(w => {
                    const p = playerById[w.playerId];
                    return {
                        player: p ? p.name : ('Player ' + w.playerId),
                        playerId: w.playerId,
                        playerColor: p && p.color ? String(p.color) : undefined,
                        playerAvatar: p && p.avatar ? p.avatar : undefined,
                        word: w.word,
                    };
                });
            const callable = fbFunctions.httpsCallable('gradeStory');
            const resp = await callable({ story: heuristic.fullStory, playerWords: attributed });
            const data = resp && resp.data ? resp.data : null;
            if (!data) return null;

            // Merge server playerStats over heuristic, matched by playerId.
            let mergedStats = heuristic.playerStats || [];
            if (Array.isArray(data.playerStats)) {
                const byId = {};
                data.playerStats.forEach(ps => {
                    if (ps && typeof ps.playerId === 'number') byId[ps.playerId] = ps;
                });
                mergedStats = mergedStats.map(hs => {
                    // Local stats use `playerName` — find the matching server
                    // entry by id via the player lookup we built above.
                    const player = players.find(p => p.name === hs.playerName);
                    const srv = player ? byId[player.id] : null;
                    return srv ? Object.assign({}, hs, srv) : hs;
                });
            }

            return Object.assign({}, heuristic, {
                storyGrade: data.storyGrade || heuristic.storyGrade,
                storyFeedback: data.storyFeedback || heuristic.storyFeedback,
                genreDetected: data.genreDetected || heuristic.genreDetected,
                moodDetected: data.moodDetected || heuristic.moodDetected,
                coherenceScore: typeof data.coherenceScore === 'number' ? data.coherenceScore : heuristic.coherenceScore,
                creativityScore: typeof data.creativityScore === 'number' ? data.creativityScore : heuristic.creativityScore,
                humorScore: typeof data.humorScore === 'number' ? data.humorScore : heuristic.humorScore,
                vocabularyScore: typeof data.vocabularyScore === 'number' ? data.vocabularyScore : heuristic.vocabularyScore,
                flowScore: typeof data.flowScore === 'number' ? data.flowScore : heuristic.flowScore,
                tags: Array.isArray(data.tags) ? data.tags : heuristic.tags,
                illustration: data.illustration || heuristic.illustration,
                playerStats: mergedStats,
            });
        } catch (e) {
            console.warn('gradeStory call failed, using heuristic result', e);
            return null;
        }
    }

    // Grade comparison now in Results module

    // awardXP, showAchievementProgress, showHighlights, ACHIEVEMENTS, launchConfetti
    // are now in the Results module (results.js)

    // --- Secret word guess UI ---
    let guessTargetIdx = null;
    const guessedPlayerIds = new Set(); // one guess per opponent
    function openGuessModal() {
        const modal = document.getElementById('guess-modal');
        const list = document.getElementById('guess-player-list');
        const inputArea = document.getElementById('guess-input-area');
        inputArea.classList.add('hidden');
        guessTargetIdx = null;
        list.innerHTML = '';
        const guessable = players.filter((p, i) => i !== Room.myIndex && !guessedPlayerIds.has(i));
        if (guessable.length === 0) {
            showToast('You\'ve already used your guess on each opponent!', '#F59E0B');
            return;
        }
        guessable.forEach((p) => {
            const i = players.indexOf(p);
            const btn = document.createElement('button');
            btn.className = 'btn btn-ghost guess-player-btn';
            btn.innerHTML = '<span class="player-stat-avatar">' + (p.avatar || '\u{1F60A}') + '</span> ' + p.name;
            btn.style.color = getPlayerColor(p.color);
            btn.addEventListener('click', () => {
                guessTargetIdx = i;
                list.querySelectorAll('.guess-player-btn').forEach(b => b.style.outline = 'none');
                btn.style.outline = '2px solid ' + getPlayerColor(p.color);
                inputArea.classList.remove('hidden');
                document.getElementById('guess-word-input').focus();
            });
            list.appendChild(btn);
        });
        modal.classList.remove('hidden');
    }

    function submitGuess() {
        if (guessTargetIdx === null) return;
        const input = document.getElementById('guess-word-input');
        const guess = input.value.trim().toLowerCase();
        if (!guess) return;
        input.value = '';

        guessedPlayerIds.add(guessTargetIdx); // one guess per opponent
        // Persist guess to Firebase
        if (Room.ref) {
            Room.ref.child('guesses/' + Room.myIndex + '/' + guessTargetIdx).set(true);
        }

        // Check against Firebase objectives
        if (Room.ref) {
            Room.ref.child('objectives/' + guessTargetIdx).once('value').then(snap => {
                const obj = snap.val();
                if (!obj || !obj.secretWord) return;
                const correct = stemForSecret(guess) === stemForSecret(obj.secretWord);
                if (correct) {
                    Room.ref.child('objectives/' + guessTargetIdx + '/busted').set(true);
                    Room.ref.child('objectives/' + guessTargetIdx + '/bustedBy').set(Room.myIndex);
                    Room.ref.child('objectives/' + guessTargetIdx + '/completed').set(true);
                    showToast('Correct! You busted ' + (players[guessTargetIdx]?.name || '?') + '\'s word!', '#10B981');
                } else {
                    // Broadcast wrong guess to all players
                    Room.ref.child('objectives/' + guessTargetIdx + '/wrongGuessBy').set(Room.myIndex);
                    showToast('Wrong guess! That\'s not their word.', '#EF4444');
                }
            });
        }
        document.getElementById('guess-modal').classList.add('hidden');
    }

    function showBustedBanner(message) {
        const banner = document.createElement('div');
        banner.className = 'objective-toast busted-banner';
        banner.innerHTML = '<span>\u{1F6A8}</span> <b>BUSTED!</b> ' + message;
        banner.style.borderColor = '#EF4444';
        banner.style.background = 'linear-gradient(135deg, #1E1E36 0%, #3A1A1A 100%)';
        document.body.appendChild(banner);
        setTimeout(() => banner.classList.add('show'), 10);
        setTimeout(() => { banner.classList.remove('show'); setTimeout(() => banner.remove(), 300); }, 4000);
    }

    function showObjectiveNotification(player, word) {
        const toast = document.createElement('div');
        toast.className = 'objective-toast';
        toast.innerHTML = '<span>' + (player.avatar || '\u{1F60A}') + '</span> <b>' +
            player.name + '</b> snuck in their secret word!';
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    }

    function showToast(message, color) {
        const toast = document.createElement('div');
        toast.className = 'objective-toast';
        toast.style.borderColor = color;
        toast.innerHTML = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500);
    }

    // Host migration
    let migrationTimer = null;
    let migrationCountdown = 30;

    function showHostMigration(hostGone) {
        const bar = document.getElementById('host-migration-bar');
        if (!bar) return;

        if (!hostGone) {
            bar.classList.add('hidden');
            if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }
            return;
        }

        bar.classList.remove('hidden');
        migrationCountdown = 30;
        const fill = document.getElementById('migration-progress-fill');
        if (fill) fill.style.width = '100%';

        if (migrationTimer) clearInterval(migrationTimer);
        migrationTimer = setInterval(() => {
            migrationCountdown--;
            if (fill) fill.style.width = (migrationCountdown / 30 * 100) + '%';
            const sub = bar.querySelector('.migration-sub');
            if (sub) sub.textContent = migrationCountdown > 0
                ? 'Waiting for host to reconnect... ' + migrationCountdown + 's'
                : 'Host did not return';
            if (migrationCountdown <= 0) {
                clearInterval(migrationTimer);
                migrationTimer = null;
            }
        }, 1000);

        document.getElementById('btn-migration-leave').onclick = () => {
            if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }
            bar.classList.add('hidden');
            Room.leave();
            App.showScreen('home');
        };
    }

    // Pause countdown (2-player disconnect)
    function startPauseCountdown() {
        pauseSecondsRemaining = 60;
        if (pauseInterval) clearInterval(pauseInterval);
        pauseInterval = setInterval(() => {
            pauseSecondsRemaining--;
            updatePauseBanner();
            if (pauseSecondsRemaining <= 0) {
                clearInterval(pauseInterval);
                pauseInterval = null;
                // Timeout: lowest connected player finishes game
                const lc = players.find(p => p.isConnected);
                if (lc && lc.id === Room.myIndex) {
                    Room.unpauseGame();
                    finishGame();
                }
            }
        }, 1000);
    }

    function clearPauseCountdown() {
        if (pauseInterval) { clearInterval(pauseInterval); pauseInterval = null; }
        pauseSecondsRemaining = 0;
    }

    function updatePauseBanner() {
        const banner = document.getElementById('pause-banner');
        if (!banner) return;
        if (!isPaused) {
            banner.classList.add('hidden');
            return;
        }
        banner.classList.remove('hidden');
        const disconnectedPlayer = players.find(p => !p.isConnected);
        const name = disconnectedPlayer ? disconnectedPlayer.name : 'Player';
        banner.querySelector('.pause-text').textContent = name + ' disconnected';
        banner.querySelector('.pause-sub').textContent =
            'Waiting for them to return... (' + pauseSecondsRemaining + 's)';
        const fill = document.getElementById('pause-progress-fill');
        if (fill) fill.style.width = (pauseSecondsRemaining / 60 * 100) + '%';
    }

    function endPausedGame() {
        if (!isPaused) return;
        clearPauseCountdown();
        Room.unpauseGame();
        finishGame();
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }
        clearPauseCountdown();
        // TTS/replay state now in Results module
        players = [];
        words = [];
        currentPlayerIndex = 0;
        turnWordCount = 0;
        hasVotedToFinish = false;
        finishVoteCount = 0;
        disconnectedIds = [];
        isPaused = false;
        secretRevealed = false;
        mySecretWord = '';
        previousObjectives = {};
        gameFinished = false;
    }

    return {
        startListening,
        submitWord,
        toggleFinishVote,
        finishGame,
        endPausedGame,
        cleanup,
        // Exposed so other modules (e.g., app.js profile forms) can gate
        // name entry on profanity and show the same styled toast used in
        // gameplay. rejectUsername is the stricter gate (leetspeak +
        // reserved names); containsProfanity is the word-boundary gameplay
        // gate. Callers should use rejectUsername for user identity.
        containsProfanity,
        rejectUsername,
        showToast,
        get ACHIEVEMENTS() { return Results.ACHIEVEMENTS; },
        get players() { return players; },
        get words() { return words; },
        get currentPlayerIndex() { return currentPlayerIndex; },
        get gameMode() { return gameMode; }
    };
})();
