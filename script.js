import {
    HandLandmarker,
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

/* =========================================
   1. 国际化 & 全局变量
   ========================================= */
const translations = {
    zh: {
        title: "🚫 不要咬指甲！",
        status_wait: "⏳ 等待摄像头授权...",
        status_ok: "✅ 监控中...",
        status_warn: "⚠️ 别吃手！放下！",
        tip: "💡 提示：点击下方 <b>'开启悬浮小窗'</b> 可隐藏此页面，后台继续监控",
        stat_today: "今日咬手次数",
        stat_streak: "已坚持 (未咬)",
        heatmap_title: "📅 过去 30 天记录 (绿色=完美, 红色=咬手)",
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
        stat_today: "Bites Today",
        stat_streak: "Streak (No Bite)",
        heatmap_title: "📅 Last 30 Days (Green=Good, Red=Bad)",
        btn_pip: "📺 PiP Mode",
        btn_start: "Start Monitoring",
        btn_stop: "Stop Monitoring",
        btn_donate: "☕ Buy me a coffee",
        modal_title: "Thanks for your support! ❤️",
        modal_desc: "Scan QR Code",
        lang_btn_text: "🇨🇳 中文"
    }
};

let currentLang = 'zh';
let handLandmarker = undefined;
let faceLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;
let lastBiteTime = Date.now(); // 上次咬手的时间
let biteCooldown = false; // 咬手冷却，防止一秒钟记录几十次

/* =========================================
   2. 数据存储模块 (LocalStorage)
   ========================================= */
const Store = {
    // 获取今天的日期字符串 YYYY-MM-DD
    getTodayKey: () => {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    },

    // 获取某一天的次数
    getCount: (dateKey) => {
        return parseInt(localStorage.getItem(`bite_count_${dateKey}`) || 0);
    },

    // 增加一次计数
    addBite: () => {
        const key = Store.getTodayKey();
        const current = Store.getCount(key);
        localStorage.setItem(`bite_count_${key}`, current + 1);
        updateUIStats(); // 刷新界面
        renderHeatmap(); // 刷新热力图
    },
    
    // 获取上次咬的时间戳
    getLastBiteTimestamp: () => {
        return parseInt(localStorage.getItem('last_bite_timestamp') || Date.now());
    },
    
    // 设置上次咬的时间
    setLastBiteTimestamp: (ts) => {
        localStorage.setItem('last_bite_timestamp', ts);
    }
};

// 初始化上次咬的时间
lastBiteTime = Store.getLastBiteTimestamp();

/* =========================================
   3. UI 更新与热力图逻辑
   ========================================= */
const todayCountEl = document.getElementById('todayCount');
const streakTimerEl = document.getElementById('streakTimer');
const heatmapEl = document.getElementById('heatmap');

function updateUIStats() {
    // 1. 更新今日次数
    todayCountEl.innerText = Store.getCount(Store.getTodayKey());
}

// 渲染热力图 (过去30天)
function renderHeatmap() {
    heatmapEl.innerHTML = ""; // 清空
    const today = new Date();
    
    // 生成过去 30 天的数据
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateKey = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        const count = Store.getCount(dateKey);
        
        const box = document.createElement('div');
        box.className = 'day-box';
        
        // 颜色逻辑
        // 0次 = 绿色(Level 1), 没数据 = 灰色(Level 0)
        // 1-5次 = 黄色(Level 2)
        // 5-20次 = 浅红(Level 3)
        // >20次 = 深红(Level 4)
        
        // 这里的逻辑有点特殊：我们需要区分“那天没用过App”和“那天用了但没咬”
        // 但为了简单，我们假设 0 就是完美
        if (count === 0) box.classList.add('level-1'); // 绿色
        else if (count <= 5) box.classList.add('level-2'); // 黄色
        else if (count <= 20) box.classList.add('level-3'); // 浅红
        else box.classList.add('level-4'); // 深红

        // 如果是今天，加个边框高亮
        if (i === 0) box.style.border = "2px solid #333";

        box.setAttribute('data-title', `${dateKey}: ${count} 次`);
        heatmapEl.appendChild(box);
    }
}

// 启动计时器刷新 (每秒更新一次 streak)
setInterval(() => {
    const now = Date.now();
    const diff = now - lastBiteTime;
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    // 格式化 00:00:00
    const fmt = (n) => n.toString().padStart(2, '0');
    streakTimerEl.innerText = `${fmt(hours)}:${fmt(minutes)}:${fmt(seconds)}`;
}, 1000);


/* =========================================
   4. 核心逻辑 (保持原有，加入计数触发)
   ========================================= */
   
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const statusText = document.getElementById("status");
const enableWebcamButton = document.getElementById("enableWebcamButton");
const pipButton = document.getElementById("pipButton");

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playAlertSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // ... (声音逻辑保持不变) ...
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
}

const createModels = async () => {
    statusText.innerText = "Loading AI Models...";
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numHands: 2
    });
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        outputFaceBlendshapes: false, runningMode: "VIDEO", numFaces: 1
    });
    
    updateUIText(); // 初始化文字
    updateUIStats(); // 初始化统计
    renderHeatmap(); // 初始化热力图
    enableWebcamButton.disabled = false;
};
createModels();

const enableCam = () => {
    if (!handLandmarker || !faceLandmarker) return;
    const btnLabel = enableWebcamButton.querySelector('.mdc-button__label');

    if (webcamRunning === true) {
        webcamRunning = false;
        btnLabel.innerText = translations[currentLang].btn_start;
        pipButton.style.display = "none";
        statusText.innerText = translations[currentLang].status_wait;
        statusText.style.color = "#333";
    } else {
        webcamRunning = true;
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
pipButton.addEventListener("click", async () => {
    if (video !== document.pictureInPictureElement) await video.requestPictureInPicture();
    else await document.exitPictureInPicture();
});

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
    if (document.hidden) setTimeout(loopLogic, 500); 
    else window.requestAnimationFrame(loopLogic);
}

async function predictWebcam() {
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const handResults = handLandmarker.detectForVideo(video, startTimeMs);
        const faceResults = faceLandmarker.detectForVideo(video, startTimeMs);

        if (!document.hidden) canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        let mouthPoint = null;
        if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
            mouthPoint = getMouthCenter(faceResults.faceLandmarks[0]);
            if (!document.hidden) drawPoint(mouthPoint, "blue");
        }

        let isBiting = false;
        if (handResults.landmarks) {
            for (const landmarks of handResults.landmarks) {
                if (!document.hidden) drawHand(landmarks);
                if (mouthPoint && checkDistance(landmarks, mouthPoint)) {
                    isBiting = true;
                }
            }
        }
        handleBiteLogic(isBiting);
    }
}

// 逻辑处理：处理咬手计数与冷却
function handleBiteLogic(isBiting) {
    const wrapper = document.querySelector('.video-wrapper');
    const t = translations[currentLang];

    if (isBiting) {
        statusText.innerText = t.status_warn;
        statusText.style.color = "red";
        if(wrapper) wrapper.classList.add('alert-mode');
        
        // 声音播放控制（频率限制）
        const now = Date.now();
        if (!window.lastAlertTime || now - window.lastAlertTime > 800) {
            playAlertSound();
            window.lastAlertTime = now;
        }

        // === 核心计数逻辑 ===
        // 如果没有在冷却中，则记录一次咬手
        if (!biteCooldown) {
            Store.addBite(); // 增加次数
            
            // 重置计时器
            lastBiteTime = Date.now();
            Store.setLastBiteTimestamp(lastBiteTime);
            
            // 开启冷却，防止连续记录 (比如3秒内算同一次咬手)
            biteCooldown = true;
            setTimeout(() => { biteCooldown = false; }, 3000); 
        }

    } else {
        statusText.innerText = t.status_ok;
        statusText.style.color = "green";
        if(wrapper) wrapper.classList.remove('alert-mode');
    }
}

// 辅助函数 (计算与绘图)
function getMouthCenter(faceLandmarks) {
    const upperLip = faceLandmarks[13];
    const lowerLip = faceLandmarks[14];
    return { x: (upperLip.x + lowerLip.x) / 2, y: (upperLip.y + lowerLip.y) / 2 };
}

function checkDistance(handLandmarks, mouthPoint) {
    const fingerTips = [4, 8, 12, 16, 20]; 
    for (let i of fingerTips) {
        const finger = handLandmarks[i];
        const dist = Math.sqrt(Math.pow(finger.x - mouthPoint.x, 2) + Math.pow(finger.y - mouthPoint.y, 2));
        if (dist < 0.1) {
            if (!document.hidden) drawLine(finger, mouthPoint);
            return true;
        }
    }
    return false;
}

function drawPoint(point, color) {
    const x = point.x * canvasElement.width;
    const y = point.y * canvasElement.height;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
    canvasCtx.fillStyle = color;
    canvasCtx.fill();
}
function drawHand(landmarks) { for (let point of landmarks) drawPoint(point, "#00FF00"); }
function drawLine(p1, p2) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
    canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
    canvasCtx.strokeStyle = "red";
    canvasCtx.lineWidth = 5;
    canvasCtx.stroke();
}

/* =========================================
   5. 交互事件
   ========================================= */
const langSwitchBtn = document.getElementById('langSwitch');
const donateBtn = document.getElementById('donateButton');
const qrModal = document.getElementById('qrModal');
const closeBtn = document.querySelector('.close-btn');

function toggleLanguage() {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    updateUIText();
}

function updateUIText() {
    const t = translations[currentLang];
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.innerHTML = t[key];
    });
    langSwitchBtn.innerText = t.lang_btn_text;
    const camBtnLabel = enableWebcamButton.querySelector('.mdc-button__label');
    camBtnLabel.innerText = webcamRunning ? t.btn_stop : t.btn_start;
    if (!webcamRunning) statusText.innerText = t.status_wait;
}

langSwitchBtn.addEventListener('click', toggleLanguage);
donateBtn.addEventListener('click', () => {
    if (currentLang === 'zh') qrModal.style.display = "block";
    else window.open('https://www.buymeacoffee.com/YOUR_USERNAME', '_blank');
});
closeBtn.addEventListener('click', () => { qrModal.style.display = "none"; });
window.addEventListener('click', (e) => { if (e.target == qrModal) qrModal.style.display = "none"; });