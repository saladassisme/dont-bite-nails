import {
    HandLandmarker,
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

/* =========================================
   1. 国际化字典 & 全局变量
   ========================================= */
const translations = {
    zh: {
        title: "🚫 不要咬指甲！",
        status_wait: "⏳ 等待摄像头授权...",
        status_ok: "✅ 监控中...",
        status_warn: "⚠️ 别吃手！放下！",
        tip: "💡 提示：点击下方 <b>'开启悬浮小窗'</b> 可隐藏此页面，后台继续监控",
        btn_pip: "📺 开启悬浮小窗",
        btn_start: "开启摄像头监控",
        btn_stop: "停止监控",
        btn_donate: "🧧 支持作者",
        modal_title: "感谢你的支持！❤️",
        modal_desc: "微信 / 支付宝 扫一扫",
        lang_btn_text: "🇺🇸 English"
    },
    en: {
        title: "🚫 No Nail Biting!",
        status_wait: "⏳ Waiting for camera permission...",
        status_ok: "✅ Monitoring...",
        status_warn: "⚠️ Don't bite! Put hand down!",
        tip: "💡 Tip: Click <b>'PiP Mode'</b> below to hide this page while monitoring.",
        btn_pip: "📺 PiP Mode",
        btn_start: "Start Monitoring",
        btn_stop: "Stop Monitoring",
        btn_donate: "☕ Buy me a coffee",
        modal_title: "Thanks for your support! ❤️",
        modal_desc: "Scan QR Code",
        lang_btn_text: "🇨🇳 中文"
    }
};

let currentLang = 'zh'; // 默认语言
let handLandmarker = undefined;
let faceLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;

// DOM 元素
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const statusText = document.getElementById("status");
const enableWebcamButton = document.getElementById("enableWebcamButton");
const pipButton = document.getElementById("pipButton");
const langSwitchBtn = document.getElementById('langSwitch');
const donateBtn = document.getElementById('donateButton');
const qrModal = document.getElementById('qrModal');
const closeBtn = document.querySelector('.close-btn');

// 声音环境
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

/* =========================================
   2. 核心功能函数
   ========================================= */

// 播放警报声
function playAlertSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = Date.now();
    if (window.lastAlertTime && now - window.lastAlertTime < 800) return;
    window.lastAlertTime = now;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'square'; 
    oscillator.frequency.setValueAtTime(500, audioCtx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(300, audioCtx.currentTime + 0.3);
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);

    if (document.hidden && Notification.permission === "granted") {
        const t = translations[currentLang];
        new Notification(t.title, {
            body: t.status_warn,
            icon: "https://via.placeholder.com/50"
        });
    }
}

// 加载模型
const createModels = async () => {
    statusText.innerText = "Loading AI Models...";
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
    });

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: false,
        runningMode: "VIDEO",
        numFaces: 1
    });

    // 模型加载完，初始化一次文本
    updateUIText();
    enableWebcamButton.disabled = false;
};
createModels();

// 开启/停止摄像头 (这里修复了文字写死的问题)
const enableCam = () => {
    if (!handLandmarker || !faceLandmarker) {
        alert("Please wait for models to load");
        return;
    }

    const btnLabel = enableWebcamButton.querySelector('.mdc-button__label');

    if (webcamRunning === true) {
        // === 停止逻辑 ===
        webcamRunning = false;
        // 动态获取当前语言的“开始”文本
        btnLabel.innerText = translations[currentLang].btn_start;
        pipButton.style.display = "none";
        // 重置状态文字
        statusText.innerText = translations[currentLang].status_wait;
        statusText.style.color = "#333";
        const wrapper = document.querySelector('.video-wrapper');
        if(wrapper) wrapper.classList.remove('alert-mode');

    } else {
        // === 开始逻辑 ===
        webcamRunning = true;
        // 动态获取当前语言的“停止”文本
        btnLabel.innerText = translations[currentLang].btn_stop;
        pipButton.style.display = "inline-block";

        const constraints = { video: true };
        navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", startLoop);
        });
    }
};
enableWebcamButton.addEventListener("click", enableCam);

// 画中画
pipButton.addEventListener("click", async () => {
    try {
        if (video !== document.pictureInPictureElement) {
            await video.requestPictureInPicture();
        } else {
            await document.exitPictureInPicture();
        }
    } catch (error) {
        console.error(error);
    }
});

// 循环检测逻辑
function startLoop() {
    canvasElement.style.width = video.videoWidth;
    canvasElement.style.height = video.videoHeight;
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    loopLogic();
}

function loopLogic() {
    if (!webcamRunning) return;
    predictWebcam();
    if (document.hidden) {
        setTimeout(loopLogic, 500); 
    } else {
        window.requestAnimationFrame(loopLogic);
    }
}

async function predictWebcam() {
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const handResults = handLandmarker.detectForVideo(video, startTimeMs);
        const faceResults = faceLandmarker.detectForVideo(video, startTimeMs);

        if (!document.hidden) {
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }

        let mouthPoint = null;
        if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
            mouthPoint = getMouthCenter(faceResults.faceLandmarks[0]);
            if (!document.hidden) drawPoint(mouthPoint, "blue");
        }

        let isBiting = false;
        if (handResults.landmarks) {
            for (const landmarks of handResults.landmarks) {
                if (!document.hidden) drawHand(landmarks);
                if (mouthPoint) {
                    if (checkDistance(landmarks, mouthPoint)) {
                        isBiting = true;
                    }
                }
            }
        }
        updateStatus(isBiting);
    }
}

/* =========================================
   3. 辅助计算与绘制
   ========================================= */
function getMouthCenter(faceLandmarks) {
    const upperLip = faceLandmarks[13];
    const lowerLip = faceLandmarks[14];
    return { x: (upperLip.x + lowerLip.x) / 2, y: (upperLip.y + lowerLip.y) / 2 };
}

function checkDistance(handLandmarks, mouthPoint) {
    const fingerTips = [4, 8, 12, 16, 20]; 
    let tooClose = false;
    for (let i of fingerTips) {
        const finger = handLandmarks[i];
        const dist = Math.sqrt(Math.pow(finger.x - mouthPoint.x, 2) + Math.pow(finger.y - mouthPoint.y, 2));
        if (dist < 0.1) { // 阈值
            tooClose = true;
            if (!document.hidden) drawLine(finger, mouthPoint);
        }
    }
    return tooClose;
}

// 状态更新 (已修复多语言支持)
function updateStatus(isBiting) {
    const wrapper = document.querySelector('.video-wrapper');
    const t = translations[currentLang];

    if (isBiting) {
        statusText.innerText = t.status_warn;
        statusText.style.color = "red";
        if(wrapper) wrapper.classList.add('alert-mode');
        playAlertSound();
    } else {
        statusText.innerText = t.status_ok;
        statusText.style.color = "green";
        if(wrapper) wrapper.classList.remove('alert-mode');
    }
}

function drawPoint(point, color) {
    const x = point.x * canvasElement.width;
    const y = point.y * canvasElement.height;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
    canvasCtx.fillStyle = color;
    canvasCtx.fill();
}

function drawHand(landmarks) {
    for (let point of landmarks) {
        drawPoint(point, "#00FF00");
    }
}

function drawLine(p1, p2) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
    canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
    canvasCtx.strokeStyle = "red";
    canvasCtx.lineWidth = 5;
    canvasCtx.stroke();
}

/* =========================================
   4. 语言切换与交互逻辑
   ========================================= */

// 切换语言
function toggleLanguage() {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    updateUIText();
}

// 更新界面所有文字
function updateUIText() {
    const t = translations[currentLang];

    // 更新所有 data-i18n 标签
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.innerHTML = t[key];
    });

    // 更新语言按钮本身
    langSwitchBtn.innerText = t.lang_btn_text;

    // 关键修复：检查当前运行状态，正确显示 Start/Stop
    const camBtnLabel = enableWebcamButton.querySelector('.mdc-button__label');
    if (webcamRunning) {
        camBtnLabel.innerText = t.btn_stop; // 如果正在运行，显示 Stop
    } else {
        camBtnLabel.innerText = t.btn_start; // 如果停止，显示 Start
    }
    
    // 如果没在运行，且没在报警，更新状态文字为“等待中”
    if (!webcamRunning) {
         statusText.innerText = t.status_wait;
    }
}

// 绑定语言按钮
langSwitchBtn.addEventListener('click', toggleLanguage);

// 智能打赏按钮
donateBtn.addEventListener('click', () => {
    if (currentLang === 'zh') {
        qrModal.style.display = "block";
    } else {
        // === 请在这里替换你的 Buy Me a Coffee 链接 ===
        window.open('https://www.buymeacoffee.com/YOUR_USERNAME', '_blank');
    }
});

closeBtn.addEventListener('click', () => { qrModal.style.display = "none"; });
window.addEventListener('click', (e) => { if (e.target == qrModal) qrModal.style.display = "none"; });
