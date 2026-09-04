/**
 * ============================================================================
 * SKALEE MASCOT LAB - CORE JAVASCRIPT CONTROLLER
 * Action Animations (Wave, Celebrate, Sparkle) | 3D Parallax | Motion Engine
 * ============================================================================
 */

(function () {
    'use strict';

    // 1. Central Layout Store (Pixel-Calibrated 1:1)
    const defaultLayout = {
        head:     { x: 66,  y: -45, scale: 1.0, rotation: -1, originX: 50.0, originY: 90.0, w: 288, h: 430, label: 'CABEÇA' },
        body:     { x: 87,  y: 316, scale: 0.9, rotation: 0,  originX: 50.0, originY: 50.0, w: 251, h: 327, label: 'CORPO' },
        leftArm:  { x: 72,  y: 351, scale: 0.75, rotation: 0, originX: 79.4, originY: 9.6,  w: 118, h: 152, label: 'BRAÇO ESQ' },
        rightArm: { x: 237, y: 350, scale: 0.75, rotation: 0, originX: 19.5, originY: 9.6,  w: 120, h: 154, label: 'BRAÇO DIR' },
        leftWing: { x: -63, y: 339, scale: 0.75, rotation: 24, originX: 91.4, originY: 10.9, w: 212, h: 199, label: 'ASA ESQ' },
        rightWing:{ x: 268, y: 331, scale: 0.75, rotation: -24,originX: 8.2,  originY: 10.9, w: 212, h: 199, label: 'ASA DIR' },
        leftEye:  { x: 111, y: 223, scale: 1.0,  rotation: -20,originX: 50.0, originY: 50.0, w: 88,  h: 117, label: 'OLHO ESQ' },
        rightEye: { x: 222, y: 221, scale: 1.04, rotation: 11, originX: 50.0, originY: 50.0, w: 88,  h: 117, label: 'OLHO DIR' }
    };

    let mascotLayout = JSON.parse(JSON.stringify(defaultLayout));

    const eyeExpressions = {
        neutral: {
            left: 'assets/mascot/eyes-neutral-left.png',
            right: 'assets/mascot/eyes-neutral-right.png',
            label: 'NEUTRAL'
        },
        blink: {
            left: 'assets/mascot/eyes-blink-left.png',
            right: 'assets/mascot/eyes-blink-right.png',
            label: 'BLINK'
        },
        alert: {
            left: 'assets/mascot/eyes-alert-left.png',
            right: 'assets/mascot/eyes-alert-right.png',
            label: 'ALERT'
        }
    };

    // DOM Elements
    const elements = {
        labStage: document.getElementById('labStage'),
        mascot: document.getElementById('mascot'),
        stageWrapper: document.getElementById('stageWrapper'),
        statusBadge: document.getElementById('statusBadge'),
        referenceOverlay: document.getElementById('referenceOverlay'),

        // Mascot Slots (Base Position & Scale Containers)
        parts: {
            head: document.getElementById('slotHead'),
            body: document.getElementById('slotBody'),
            leftArm: document.getElementById('slotArmLeft'),
            rightArm: document.getElementById('slotArmRight'),
            leftWing: document.getElementById('slotWingLeft'),
            rightWing: document.getElementById('slotWingRight'),
            leftEye: document.getElementById('slotEyeLeft'),
            rightEye: document.getElementById('slotEyeRight')
        },

        // Part HUD badges
        hudBadges: {
            head: document.getElementById('hudHead'),
            body: document.getElementById('hudBody'),
            leftArm: document.getElementById('hudArmLeft'),
            rightArm: document.getElementById('hudArmRight'),
            leftWing: document.getElementById('hudWingLeft'),
            rightWing: document.getElementById('hudWingRight'),
            leftEye: document.getElementById('hudEyeLeft'),
            rightEye: document.getElementById('hudEyeRight')
        },

        // Eye Imgs (For Blinking ScaleY Animation)
        leftEye: document.getElementById('eyeLeft'),
        rightEye: document.getElementById('eyeRight'),

        // Pivot Dots
        pivotWingLeft: document.getElementById('pivotDotWingLeft'),
        pivotWingRight: document.getElementById('pivotDotWingRight'),
        pivotArmLeft: document.getElementById('pivotDotArmLeft'),
        pivotArmRight: document.getElementById('pivotDotArmRight'),
        pivotHead: document.getElementById('pivotDotHead'),
        pivotBody: document.getElementById('pivotDotBody'),

        // Primary & Action Buttons
        btnIdle: document.getElementById('btnIdle'),
        btnWave: document.getElementById('btnWave'),
        btnCelebrate: document.getElementById('btnCelebrate'),
        btnSparkle: document.getElementById('btnSparkle'),
        btnBlink: document.getElementById('btnBlink'),
        btnEyeNeutral: document.getElementById('btnEyeNeutral'),
        btnEyeBlink: document.getElementById('btnEyeBlink'),
        btnEyeAlert: document.getElementById('btnEyeAlert'),

        // Wing Poses & Size Buttons
        btnWingRest: document.getElementById('btnWingRest'),
        btnWingOpen: document.getElementById('btnWingOpen'),
        btnWingRaised: document.getElementById('btnWingRaised'),
        btnSizeSmall: document.getElementById('btnSizeSmall'),
        btnSizeMedium: document.getElementById('btnSizeMedium'),
        btnSizeLarge: document.getElementById('btnSizeLarge'),

        // Tool Buttons
        btnLookAtMouse: document.getElementById('btnLookAtMouse'),
        btnPivots: document.getElementById('btnPivots'),
        btnOverlay: document.getElementById('btnOverlay'),
        btnCopyLayout: document.getElementById('btnCopyLayout'),
        btnResetAssembly: document.getElementById('btnResetAssembly'),

        // Horizontal Inspector Elements
        partTabs: document.querySelectorAll('.part-tab'),
        inspSliderX: document.getElementById('inspSliderX'),
        inspValX: document.getElementById('inspValX'),
        inspSliderY: document.getElementById('inspSliderY'),
        inspValY: document.getElementById('inspValY'),
        inspSliderRot: document.getElementById('inspSliderRot'),
        inspValRot: document.getElementById('inspValRot'),
        inspSliderScale: document.getElementById('inspSliderScale'),
        inspValScale: document.getElementById('inspValScale')
    };

    // App State
    const state = {
        mascotState: 'idle',     // 'idle' | 'waving' | 'celebrating' | 'sparkling' | 'static'
        wingState: 'open',       // 'rest' | 'open' | 'raised'
        size: 'medium',          // 'small' | 'medium' | 'large'
        isFloating: true,
        showPivots: false,
        showOverlay: false,
        eyeExpression: 'neutral',
        renderedEyeExpression: 'neutral',
        isBlinking: false,
        autoBlinkTimer: null,
        actionTimeout: null,
        
        // Touch & Drag Interaction State
        selectedPart: 'head',
        isDragging: false,
        dragPointerId: null,
        dragOffset: { x: 0, y: 0 },

        // 3D Parallax Look-At Mouse State
        lookAtMouseActive: true,
        targetLookX: 0,
        targetLookY: 0,
        currentLookX: 0,
        currentLookY: 0
    };

    /**
     * Auto-scales stage wrapper dynamically to fit viewport height perfectly
     */
    function updateViewportScale() {
        if (!elements.labStage) return;
        const stageH = elements.labStage.clientHeight - 24;
        const stageW = elements.labStage.clientWidth - 24;
        const scaleH = stageH / 621;
        const scaleW = stageW / 430;
        const autoScale = Math.max(0.35, Math.min(1.0, Math.min(scaleH, scaleW)));
        document.documentElement.style.setProperty('--viewport-scale', autoScale.toFixed(3));
    }

    /**
     * ========================================================================
     * LAYOUT APPLICATION ENGINE (Separates Base Coordinates from Keyframes)
     * ========================================================================
     */

    function applyLayout() {
        for (const [key, el] of Object.entries(elements.parts)) {
            const data = mascotLayout[key];
            if (el && data) {
                el.style.left = `${data.x}px`;
                el.style.top = `${data.y}px`;
                el.style.transformOrigin = `${data.originX}% ${data.originY}%`;
                el.style.transform = `scale(${data.scale || 1.0}) rotate(${data.rotation || 0}deg)`;

                // Update HUD Badge
                const hud = elements.hudBadges[key];
                if (hud) {
                    hud.textContent = `${data.label || key.toUpperCase()} • X: ${data.x}, Y: ${data.y}`;
                }
            }
        }

        // Exact Articulation Pivot Marker Positions
        if (elements.pivotWingLeft) {
            elements.pivotWingLeft.style.left = `${mascotLayout.leftWing.x + mascotLayout.leftWing.w * (mascotLayout.leftWing.originX / 100)}px`;
            elements.pivotWingLeft.style.top = `${mascotLayout.leftWing.y + mascotLayout.leftWing.h * (mascotLayout.leftWing.originY / 100)}px`;
        }
        if (elements.pivotWingRight) {
            elements.pivotWingRight.style.left = `${mascotLayout.rightWing.x + mascotLayout.rightWing.w * (mascotLayout.rightWing.originX / 100)}px`;
            elements.pivotWingRight.style.top = `${mascotLayout.rightWing.y + mascotLayout.rightWing.h * (mascotLayout.rightWing.originY / 100)}px`;
        }
        if (elements.pivotArmLeft) {
            elements.pivotArmLeft.style.left = `${mascotLayout.leftArm.x + mascotLayout.leftArm.w * (mascotLayout.leftArm.originX / 100)}px`;
            elements.pivotArmLeft.style.top = `${mascotLayout.leftArm.y + mascotLayout.leftArm.h * (mascotLayout.leftArm.originY / 100)}px`;
        }
        if (elements.pivotArmRight) {
            elements.pivotArmRight.style.left = `${mascotLayout.rightArm.x + mascotLayout.rightArm.w * (mascotLayout.rightArm.originX / 100)}px`;
            elements.pivotArmRight.style.top = `${mascotLayout.rightArm.y + mascotLayout.rightArm.h * (mascotLayout.rightArm.originY / 100)}px`;
        }
        if (elements.pivotHead) {
            elements.pivotHead.style.left = `${mascotLayout.head.x + mascotLayout.head.w * (mascotLayout.head.originX / 100)}px`;
            elements.pivotHead.style.top = `${mascotLayout.head.y + mascotLayout.head.h * (mascotLayout.head.originY / 100)}px`;
        }
        if (elements.pivotBody) {
            elements.pivotBody.style.left = `${mascotLayout.body.x + mascotLayout.body.w * (mascotLayout.body.originX / 100)}px`;
            elements.pivotBody.style.top = `${mascotLayout.body.y + mascotLayout.body.h * (mascotLayout.body.originY / 100)}px`;
        }
    }

    /**
     * Sync Horizontal Inspector Sliders from current selected part
     */
    function syncInspectorFromLayout() {
        const data = mascotLayout[state.selectedPart];
        if (!data) return;

        if (elements.inspSliderX) {
            elements.inspSliderX.value = data.x;
            elements.inspValX.textContent = data.x;
        }
        if (elements.inspSliderY) {
            elements.inspSliderY.value = data.y;
            elements.inspValY.textContent = data.y;
        }
        if (elements.inspSliderRot) {
            elements.inspSliderRot.value = data.rotation || 0;
            elements.inspValRot.textContent = data.rotation || 0;
        }
        if (elements.inspSliderScale) {
            elements.inspSliderScale.value = data.scale || 1.0;
            elements.inspValScale.textContent = (data.scale || 1.0).toFixed(2);
        }
    }

    /**
     * ========================================================================
     * SELECTION & DIRECT MANIPULATION CONTROLLER
     * ========================================================================
     */

    function selectPart(partKey) {
        if (!mascotLayout[partKey]) return;
        state.selectedPart = partKey;

        // Update DOM classes for parts
        for (const [key, el] of Object.entries(elements.parts)) {
            if (el) {
                if (key === partKey) {
                    el.classList.add('is-selected');
                } else {
                    el.classList.remove('is-selected');
                }
            }
        }

        // Update Part Tabs in Inspector
        if (elements.partTabs) {
            elements.partTabs.forEach(tab => {
                if (tab.getAttribute('data-part') === partKey) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });
        }

        syncInspectorFromLayout();
    }

    function initDirectManipulation() {
        for (const [partKey, el] of Object.entries(elements.parts)) {
            if (!el) continue;

            el.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();

                selectPart(partKey);
                state.isDragging = true;
                state.dragPointerId = e.pointerId;
                el.setPointerCapture(e.pointerId);
                el.classList.add('is-dragging');

                const mascotRect = elements.mascot.getBoundingClientRect();
                const scale = mascotRect.width / 430;

                const canvasX = (e.clientX - mascotRect.left) / scale;
                const canvasY = (e.clientY - mascotRect.top) / scale;

                state.dragOffset = {
                    x: canvasX - mascotLayout[partKey].x,
                    y: canvasY - mascotLayout[partKey].y
                };
            });

            el.addEventListener('pointermove', (e) => {
                if (!state.isDragging || state.selectedPart !== partKey || e.pointerId !== state.dragPointerId) return;
                e.preventDefault();

                const mascotRect = elements.mascot.getBoundingClientRect();
                const scale = mascotRect.width / 430;

                const canvasX = (e.clientX - mascotRect.left) / scale;
                const canvasY = (e.clientY - mascotRect.top) / scale;

                const newX = Math.round(canvasX - state.dragOffset.x);
                const newY = Math.round(canvasY - state.dragOffset.y);

                mascotLayout[partKey].x = newX;
                mascotLayout[partKey].y = newY;

                applyLayout();
                syncInspectorFromLayout();
            });

            const endDrag = (e) => {
                if (state.isDragging && e.pointerId === state.dragPointerId) {
                    state.isDragging = false;
                    state.dragPointerId = null;
                    el.classList.remove('is-dragging');
                    try {
                        el.releasePointerCapture(e.pointerId);
                    } catch (_) {}
                }
            };

            el.addEventListener('pointerup', endDrag);
            el.addEventListener('pointercancel', endDrag);

            // Wheel rotation on hover
            el.addEventListener('wheel', (e) => {
                if (state.selectedPart === partKey) {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 1 : -1;
                    mascotLayout[partKey].rotation = (mascotLayout[partKey].rotation || 0) + delta;
                    applyLayout();
                    syncInspectorFromLayout();
                }
            }, { passive: false });
        }

        // Tab selection click
        if (elements.partTabs) {
            elements.partTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const part = tab.getAttribute('data-part');
                    if (part) selectPart(part);
                });
            });
        }

        // Inspector slider bindings
        if (elements.inspSliderX) {
            elements.inspSliderX.addEventListener('input', () => {
                const val = parseInt(elements.inspSliderX.value, 10);
                mascotLayout[state.selectedPart].x = val;
                elements.inspValX.textContent = val;
                applyLayout();
            });
        }

        if (elements.inspSliderY) {
            elements.inspSliderY.addEventListener('input', () => {
                const val = parseInt(elements.inspSliderY.value, 10);
                mascotLayout[state.selectedPart].y = val;
                elements.inspValY.textContent = val;
                applyLayout();
            });
        }

        if (elements.inspSliderRot) {
            elements.inspSliderRot.addEventListener('input', () => {
                const val = parseInt(elements.inspSliderRot.value, 10);
                mascotLayout[state.selectedPart].rotation = val;
                elements.inspValRot.textContent = val;
                applyLayout();
            });
        }

        if (elements.inspSliderScale) {
            elements.inspSliderScale.addEventListener('input', () => {
                const val = parseFloat(elements.inspSliderScale.value);
                mascotLayout[state.selectedPart].scale = val;
                elements.inspValScale.textContent = val.toFixed(2);
                applyLayout();
            });
        }

        // Keyboard Arrow Nudge Support
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            if (state.selectedPart && mascotLayout[state.selectedPart]) {
                const step = e.shiftKey ? 5 : 1;
                let handled = false;

                if (e.key === 'ArrowUp') {
                    mascotLayout[state.selectedPart].y -= step;
                    handled = true;
                } else if (e.key === 'ArrowDown') {
                    mascotLayout[state.selectedPart].y += step;
                    handled = true;
                } else if (e.key === 'ArrowLeft') {
                    mascotLayout[state.selectedPart].x -= step;
                    handled = true;
                } else if (e.key === 'ArrowRight') {
                    mascotLayout[state.selectedPart].x += step;
                    handled = true;
                } else if (e.key === '[' || e.key === '{') {
                    mascotLayout[state.selectedPart].rotation = (mascotLayout[state.selectedPart].rotation || 0) - (e.shiftKey ? 5 : 1);
                    handled = true;
                } else if (e.key === ']' || e.key === '}') {
                    mascotLayout[state.selectedPart].rotation = (mascotLayout[state.selectedPart].rotation || 0) + (e.shiftKey ? 5 : 1);
                    handled = true;
                }

                if (handled) {
                    e.preventDefault();
                    applyLayout();
                    syncInspectorFromLayout();
                }
            }
        });
    }

    /**
     * ========================================================================
     * 3D PARALLAX (LOOK AT MOUSE ENGINE)
     * ========================================================================
     */

    function initLookAtMouse() {
        if (!elements.labStage) return;

        elements.labStage.addEventListener('pointermove', (e) => {
            if (!state.lookAtMouseActive || state.isDragging) return;

            const rect = elements.labStage.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Normalized to [-1, 1]
            state.targetLookX = Math.max(-1, Math.min(1, (e.clientX - centerX) / (rect.width / 2)));
            state.targetLookY = Math.max(-1, Math.min(1, (e.clientY - centerY) / (rect.height / 2)));
        });

        elements.labStage.addEventListener('pointerleave', () => {
            state.targetLookX = 0;
            state.targetLookY = 0;
        });

        function updateParallaxLoop() {
            if (state.lookAtMouseActive) {
                // Smooth Lerp Damping
                state.currentLookX += (state.targetLookX - state.currentLookX) * 0.08;
                state.currentLookY += (state.targetLookY - state.currentLookY) * 0.08;

                const headX = (state.currentLookX * 5).toFixed(2);
                const headY = (state.currentLookY * 3).toFixed(2);
                const headRot = (state.currentLookX * 4).toFixed(2);

                const eyesX = (state.currentLookX * 7.5).toFixed(2);
                const eyesY = (state.currentLookY * 5.5).toFixed(2);

                document.documentElement.style.setProperty('--look-head-x', `${headX}px`);
                document.documentElement.style.setProperty('--look-head-y', `${headY}px`);
                document.documentElement.style.setProperty('--look-head-rot', `${headRot}deg`);
                document.documentElement.style.setProperty('--look-eyes-x', `${eyesX}px`);
                document.documentElement.style.setProperty('--look-eyes-y', `${eyesY}px`);
            } else {
                document.documentElement.style.setProperty('--look-head-x', '0px');
                document.documentElement.style.setProperty('--look-head-y', '0px');
                document.documentElement.style.setProperty('--look-head-rot', '0deg');
                document.documentElement.style.setProperty('--look-eyes-x', '0px');
                document.documentElement.style.setProperty('--look-eyes-y', '0px');
            }

            requestAnimationFrame(updateParallaxLoop);
        }

        requestAnimationFrame(updateParallaxLoop);
    }

    function toggleLookAtMouse() {
        state.lookAtMouseActive = !state.lookAtMouseActive;
        if (elements.btnLookAtMouse) {
            if (state.lookAtMouseActive) {
                elements.btnLookAtMouse.classList.add('active');
            } else {
                elements.btnLookAtMouse.classList.remove('active');
                state.targetLookX = 0;
                state.targetLookY = 0;
            }
        }
    }

    /**
     * ========================================================================
     * ACTION ANIMATIONS ENGINE (WAVE, CELEBRATE, SPARKLE)
     * ========================================================================
     */

    function clearActionClasses() {
        if (state.actionTimeout) {
            clearTimeout(state.actionTimeout);
            state.actionTimeout = null;
        }
        elements.mascot.classList.remove('is-waving', 'is-celebrating', 'is-sparkling');
    }

    function triggerWave() {
        clearActionClasses();
        state.mascotState = 'waving';
        elements.mascot.classList.add('is-waving');
        updateStatusBadge('WAVING (👋)');

        state.actionTimeout = setTimeout(() => {
            clearActionClasses();
            setMascotState('idle');
        }, 2400);
    }

    function triggerCelebrate() {
        clearActionClasses();
        state.mascotState = 'celebrating';
        elements.mascot.classList.add('is-celebrating');
        updateStatusBadge('CELEBRATING (🎉)');

        // Quick double blink during celebration
        blinkMascot();
        setTimeout(blinkMascot, 600);

        state.actionTimeout = setTimeout(() => {
            clearActionClasses();
            setMascotState('idle');
        }, 2200);
    }

    function triggerSparkle() {
        clearActionClasses();
        state.mascotState = 'sparkling';
        elements.mascot.classList.add('is-sparkling');
        updateStatusBadge('SPARKLE (⚡)');

        state.actionTimeout = setTimeout(() => {
            clearActionClasses();
            setMascotState('idle');
        }, 2000);
    }

    /**
     * ========================================================================
     * STATE MANAGEMENT & WING POSES
     * ========================================================================
     */

    function setMascotState(newState) {
        state.mascotState = newState;

        if (newState === 'idle') {
            clearActionClasses();
            state.isFloating = true;
            elements.mascot.classList.add('is-floating');
            elements.btnIdle.classList.add('active');
            document.body.classList.add('is-active-idle');
            updateStatusBadge('IDLE');
            startAutoBlink();
        } else {
            clearActionClasses();
            state.isFloating = false;
            elements.mascot.classList.remove('is-floating');
            elements.btnIdle.classList.remove('active');
            document.body.classList.remove('is-active-idle');
            updateStatusBadge('STATIC');
            stopAutoBlink();
        }
    }

    function setWingState(wingState) {
        state.wingState = wingState;

        const angles = {
            rest: { left: -10, right: 10 },
            open: { left: 14, right: -14 },
            raised: { left: 24, right: -24 }
        };

        const target = angles[wingState] || angles.open;
        mascotLayout.leftWing.rotation = target.left;
        mascotLayout.rightWing.rotation = target.right;

        [elements.btnWingRest, elements.btnWingOpen, elements.btnWingRaised].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        if (wingState === 'rest' && elements.btnWingRest) elements.btnWingRest.classList.add('active');
        if (wingState === 'open' && elements.btnWingOpen) elements.btnWingOpen.classList.add('active');
        if (wingState === 'raised' && elements.btnWingRaised) elements.btnWingRaised.classList.add('active');

        applyLayout();
        syncInspectorFromLayout();
    }

    function setMascotSize(size) {
        state.size = size;
        const scales = {
            small: 0.7,
            medium: 1.0,
            large: 1.25
        };

        const targetScale = scales[size] || 1.0;
        document.documentElement.style.setProperty('--mascot-scale', targetScale);

        [elements.btnSizeSmall, elements.btnSizeMedium, elements.btnSizeLarge].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        if (size === 'small' && elements.btnSizeSmall) elements.btnSizeSmall.classList.add('active');
        if (size === 'medium' && elements.btnSizeMedium) elements.btnSizeMedium.classList.add('active');
        if (size === 'large' && elements.btnSizeLarge) elements.btnSizeLarge.classList.add('active');
    }

    function updateStatusBadge(text) {
        if (elements.statusBadge) {
            const textEl = elements.statusBadge.querySelector('.status-text');
            if (textEl) textEl.textContent = `STATE: ${text}`;
        }
    }

    function syncEyeExpressionButtons() {
        [elements.btnEyeNeutral, elements.btnEyeBlink, elements.btnEyeAlert].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        const activeButton = {
            neutral: elements.btnEyeNeutral,
            blink: elements.btnEyeBlink,
            alert: elements.btnEyeAlert
        }[state.eyeExpression];

        if (activeButton) activeButton.classList.add('active');
    }

    function renderEyeExpression(expression) {
        const nextExpression = eyeExpressions[expression] ? expression : 'neutral';
        const config = eyeExpressions[nextExpression];

        state.renderedEyeExpression = nextExpression;

        if (elements.leftEye) {
            elements.leftEye.src = config.left;
            elements.leftEye.dataset.expression = nextExpression;
        }

        if (elements.rightEye) {
            elements.rightEye.src = config.right;
            elements.rightEye.dataset.expression = nextExpression;
        }
    }

    function setEyeExpression(expression, options = {}) {
        const nextExpression = eyeExpressions[expression] ? expression : 'neutral';

        state.eyeExpression = nextExpression;
        renderEyeExpression(nextExpression);

        if (options.syncButtons !== false) {
            syncEyeExpressionButtons();
        }
    }

    /**
     * ========================================================================
     * NATURAL BLINK ENGINE
     * ========================================================================
     */

    function blinkMascot() {
        if (state.isBlinking) return;
        state.isBlinking = true;

        renderEyeExpression('blink');

        if (elements.leftEye) elements.leftEye.classList.add('is-blinking');
        if (elements.rightEye) elements.rightEye.classList.add('is-blinking');

        setTimeout(() => {
            if (elements.leftEye) elements.leftEye.classList.remove('is-blinking');
            if (elements.rightEye) elements.rightEye.classList.remove('is-blinking');
            renderEyeExpression(state.eyeExpression);
            state.isBlinking = false;
        }, 180);
    }

    function scheduleNextBlink() {
        if (state.autoBlinkTimer) clearTimeout(state.autoBlinkTimer);
        const delay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
        state.autoBlinkTimer = setTimeout(() => {
            blinkMascot();
            if (state.isFloating) scheduleNextBlink();
        }, delay);
    }

    function startAutoBlink() {
        scheduleNextBlink();
    }

    function stopAutoBlink() {
        if (state.autoBlinkTimer) {
            clearTimeout(state.autoBlinkTimer);
            state.autoBlinkTimer = null;
        }
    }

    function togglePivots() {
        state.showPivots = !state.showPivots;
        if (state.showPivots) {
            elements.stageWrapper.classList.add('show-pivots');
            elements.btnPivots.classList.add('active');
        } else {
            elements.stageWrapper.classList.remove('show-pivots');
            elements.btnPivots.classList.remove('active');
        }
    }

    function toggleOverlay() {
        state.showOverlay = !state.showOverlay;
        if (state.showOverlay) {
            elements.labStage.classList.add('show-overlay');
            elements.btnOverlay.classList.add('active');
        } else {
            elements.labStage.classList.remove('show-overlay');
            elements.btnOverlay.classList.remove('active');
        }
    }

    function resetAssembly() {
        mascotLayout = JSON.parse(JSON.stringify(defaultLayout));
        applyLayout();
        syncInspectorFromLayout();
    }

    function copyLayoutJSON() {
        const json = JSON.stringify(mascotLayout, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            const origText = elements.btnCopyLayout.textContent;
            elements.btnCopyLayout.textContent = '✅ COPIADO!';
            setTimeout(() => {
                elements.btnCopyLayout.textContent = origText;
            }, 2000);
        }).catch(err => {
            console.error('Falha ao copiar JSON:', err);
            prompt('Copie o JSON abaixo:', json);
        });
    }

    /**
     * ========================================================================
     * EVENT LISTENERS
     * ========================================================================
     */

    function initEventListeners() {
        window.addEventListener('resize', updateViewportScale);

        // Toggle Idle / Static
        elements.btnIdle.addEventListener('click', () => {
            if (state.mascotState === 'idle') {
                setMascotState('static');
            } else {
                setMascotState('idle');
            }
        });

        // Action Animation Triggers
        if (elements.btnWave) elements.btnWave.addEventListener('click', triggerWave);
        if (elements.btnCelebrate) elements.btnCelebrate.addEventListener('click', triggerCelebrate);
        if (elements.btnSparkle) elements.btnSparkle.addEventListener('click', triggerSparkle);
        if (elements.btnBlink) elements.btnBlink.addEventListener('click', blinkMascot);

        // Eye Expression Triggers
        if (elements.btnEyeNeutral) elements.btnEyeNeutral.addEventListener('click', () => setEyeExpression('neutral'));
        if (elements.btnEyeBlink) elements.btnEyeBlink.addEventListener('click', () => setEyeExpression('blink'));
        if (elements.btnEyeAlert) elements.btnEyeAlert.addEventListener('click', () => setEyeExpression('alert'));

        // Wing State Triggers
        elements.btnWingRest.addEventListener('click', () => setWingState('rest'));
        elements.btnWingOpen.addEventListener('click', () => setWingState('open'));
        elements.btnWingRaised.addEventListener('click', () => setWingState('raised'));

        // Size Triggers
        elements.btnSizeSmall.addEventListener('click', () => setMascotSize('small'));
        elements.btnSizeMedium.addEventListener('click', () => setMascotSize('medium'));
        elements.btnSizeLarge.addEventListener('click', () => setMascotSize('large'));

        // Tool Triggers
        if (elements.btnLookAtMouse) elements.btnLookAtMouse.addEventListener('click', toggleLookAtMouse);
        elements.btnPivots.addEventListener('click', togglePivots);
        elements.btnOverlay.addEventListener('click', toggleOverlay);
        elements.btnResetAssembly.addEventListener('click', resetAssembly);
        elements.btnCopyLayout.addEventListener('click', copyLayoutJSON);

        // Global shortcuts (W: Wave, C: Celebrate, S: Sparkle, Space: Blink, P: Pivots, O: Overlay)
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.code === 'Space') {
                e.preventDefault();
                blinkMascot();
            } else if (e.key.toLowerCase() === 'w') {
                triggerWave();
            } else if (e.key.toLowerCase() === 'c') {
                triggerCelebrate();
            } else if (e.key.toLowerCase() === 's') {
                triggerSparkle();
            } else if (e.key.toLowerCase() === 'p') {
                togglePivots();
            } else if (e.key.toLowerCase() === 'o') {
                toggleOverlay();
            }
        });
    }

    /**
     * ========================================================================
     * INIT
     * ========================================================================
     */
    function init() {
        console.log('%c [SKALEE MASCOT LAB] Action & Parallax Engine Activated ', 'background: #00e5ff; color: #05070d; font-weight: bold; padding: 4px 8px; border-radius: 4px;');
        updateViewportScale();
        applyLayout();
        selectPart('head');
        setEyeExpression('neutral');
        setWingState('open');
        setMascotSize('medium');
        setMascotState('idle');
        initEventListeners();
        initDirectManipulation();
        initLookAtMouse();
    }

    // Expose global interface for console testing
    window.SkaleeMascot = {
        layout: mascotLayout,
        applyLayout: applyLayout,
        setState: setMascotState,
        setWingState: setWingState,
        setSize: setMascotSize,
        selectPart: selectPart,
        wave: triggerWave,
        celebrate: triggerCelebrate,
        sparkle: triggerSparkle,
        blink: blinkMascot,
        setEyeExpression: setEyeExpression,
        resetAssembly: resetAssembly
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
