import {
    HandLandmarker,
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const statusText = document.getElementById("status");
const enableWebcamButton = document.getElementById("enableWebcamButton");
const pipButton = document.getElementById("pipButton");

let handLandmarker = undefined;
let faceLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;

// 声音上下文
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// 请求通知权限（用于后台弹窗）
if (Notification.permission !== "granted") {
    Notification.requestPermission();
}

function playAlertSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = Date.now();
    if (window.lastAlertTime && now - window.lastAlertTime < 800) return; // 稍微把间隔调大一点，避免太吵
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

    // 如果页面在后台，发送系统通知
    if (document.hidden && Notification.permission === "granted") {
        new Notification("⚠️ 不要咬手！", {
            body: "监测到手部动作，请放下手。",
            icon: "https://via.placeholder.com/50" // 可以换成你自己的图标
        });
    }
}

// 1. 加载 AI 模型
const createModels = async () => {
    statusText.innerText = "正在加载 AI 模型...";
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

    statusText.innerText = "模型加载完毕";
    enableWebcamButton.disabled = false;
};
createModels();

// 2. 开启摄像头
const enableCam = () => {
    if (!handLandmarker || !faceLandmarker) {
        alert("模型未加载");
        return;
    }

    if (webcamRunning === true) {
        webcamRunning = false;
        enableWebcamButton.innerText = "开启摄像头监控";
        pipButton.style.display = "none";
    } else {
        webcamRunning = true;
        enableWebcamButton.innerText = "停止监控";
        pipButton.style.display = "inline-block"; // 显示画中画按钮

        const constraints = { video: true };
        navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", startLoop);
        });
    }
};
enableWebcamButton.addEventListener("click", enableCam);

// 3. 画中画功能 (悬浮窗)
pipButton.addEventListener("click", async () => {
    try {
        if (video !== document.pictureInPictureElement) {
            await video.requestPictureInPicture();
        } else {
            await document.exitPictureInPicture();
        }
    } catch (error) {
        console.error(error);
        alert("你的浏览器可能不支持画中画或出现错误");
    }
});

// 4. 智能循环逻辑 (解决后台停止运行问题)
function startLoop() {
    // 设置画布尺寸
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
        // 如果页面在后台，使用 setTimeout 降低频率 (500ms检测一次)
        // 这比 requestAnimationFrame 靠谱，因为浏览器不太会完全杀掉低频 timer
        setTimeout(loopLogic, 500); 
    } else {
        // 如果页面在前台，全力运行以获得流畅画面
        window.requestAnimationFrame(loopLogic);
    }
}

async function predictWebcam() {
    let startTimeMs = performance.now();

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        
        const handResults = handLandmarker.detectForVideo(video, startTimeMs);
        const faceResults = faceLandmarker.detectForVideo(video, startTimeMs);

        // 在后台时，我们不需要绘制 Canvas (省资源)，只需要听声音
        // 只有在前台时才清空和绘制
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

// 获取嘴巴中心
function getMouthCenter(faceLandmarks) {
    const upperLip = faceLandmarks[13];
    const lowerLip = faceLandmarks[14];
    return {
        x: (upperLip.x + lowerLip.x) / 2,
        y: (upperLip.y + lowerLip.y) / 2
    };
}

// 核心检测：修正手指数组
function checkDistance(handLandmarks, mouthPoint) {
    // 修正：加入了 16 (无名指) 和 20 (小指)
    const fingerTips = [4, 8, 12, 16, 20]; 
    let tooClose = false;

    for (let i of fingerTips) {
        const finger = handLandmarks[i];
        const dist = Math.sqrt(
            Math.pow(finger.x - mouthPoint.x, 2) + 
            Math.pow(finger.y - mouthPoint.y, 2)
        );

        const THRESHOLD = 0.1; // 距离阈值

        if (dist < THRESHOLD) {
            tooClose = true;
            // 只在前台绘制红线
            if (!document.hidden) drawLine(finger, mouthPoint);
        }
    }
    return tooClose;
}

function updateStatus(isBiting) {
    const wrapper = document.querySelector('.video-wrapper');
    if (isBiting) {
        statusText.innerText = "⚠️ 别吃手！放下！";
        statusText.style.color = "red";
        if(wrapper) wrapper.classList.add('alert-mode');
        playAlertSound();
    } else {
        statusText.innerText = "✅ 监控中...";
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