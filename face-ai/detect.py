import sys, os, json, time, threading, re, collections

# Force OpenCV's FFmpeg RTSP backend to use TCP and bail on dead reads/opens.
# Must be set BEFORE `import cv2` because cv2 caches it on first VideoCapture.
# stimeout/timeout are in microseconds; 5s is enough for a slow camera but
# short enough that a hung MediaMTX path recycles instead of wedging the thread.
os.environ.setdefault(
    'OPENCV_FFMPEG_CAPTURE_OPTIONS',
    'rtsp_transport;tcp|stimeout;5000000|timeout;5000000',
)

import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
ENROLLMENT_DIR = os.path.join(HERE, 'enrollments')
FACE_MODEL_PATH = os.path.join(HERE, 'blaze_face_short_range.tflite')
YOLO_MODEL_PATH = os.path.join(HERE, 'yolov8n.pt') # Standard nano model
FIRE_MODEL_PATH = os.path.join(HERE, 'fire_model.pt') # Optional custom model

FRAME_SKIP = 5               # Process every 5th frame to reduce CPU load

# LBPH face-recognition strictness. LBPH distance is "lower is better".
#   < 50  : very strict, near-perfect lighting/pose required (lots of "Unknown")
#   50-70 : strict — only confident matches get a name (recommended for live cams)
#   70-90 : moderate — relaxed enough for varied lighting; some look-alikes leak
#   > 100 : loose — false matches between similar-looking people are common
# Override via FACE_RECOGNITION_THRESHOLD env var without editing the file.
RECOGNITION_THRESHOLD     = int(os.environ.get('FACE_RECOGNITION_THRESHOLD', '70'))

# Faces smaller than this fraction of the (downscaled) frame area are too noisy
# to recognize reliably. Below the cutoff we still detect the face but don't
# attempt to identify it — better an "unknown" box than a wrong name.
MIN_FACE_AREA_RATIO       = 0.005

# Temporal stability: a name only "sticks" after the recognizer agrees on it
# for this many consecutive processed frames. Suppresses single-frame mistakes.
RECOGNITION_CONFIRM_FRAMES = 2

def log(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()

# ── Download models if needed ──────────────────────────────────
if not os.path.exists(FACE_MODEL_PATH):
    import urllib.request
    log({'type': 'info', 'message': 'Downloading face model...'})
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/face_detector/'
        'blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
        FACE_MODEL_PATH)

# ── AI Models ────────────────────────────────────────────────
# MediaPipe Face Detector
face_base_options = mp_python.BaseOptions(model_asset_path=FACE_MODEL_PATH)
face_detector_options = mp_vision.FaceDetectorOptions(
    base_options=face_base_options,
    min_detection_confidence=0.5,
    min_suppression_threshold=0.3,
)
shared_face_detector = mp_vision.FaceDetector.create_from_options(face_detector_options)
face_detector_lock = threading.Lock()


# YOLOv8 for General Objects & Incidents
yolo_model = YOLO(YOLO_MODEL_PATH)
log({'type': 'info', 'message': 'YOLOv8 base model loaded'})

fire_model = None
if os.path.exists(FIRE_MODEL_PATH) and os.path.getsize(FIRE_MODEL_PATH) > 1000000:
    try:
        fire_model = YOLO(FIRE_MODEL_PATH)
        log({'type': 'info', 'message': 'Custom Fire Model loaded'})
    except Exception as e:
        log({'type': 'warning', 'message': f'Failed to load fire model: {e}'})
else:
    log({'type': 'info', 'message': 'No custom fire model found (using color-based fallback)'})

yolo_lock = threading.Lock()

# ── Per-directory LBPH recognizers ──────────────────────────────
# Each user has their own enrollment dir → their own recognizer.
# The dict is keyed by absolute path; entries are created lazily.
class DirRecognizer:
    __slots__ = ('recognizer', 'names_map', 'ready', 'lock')
    def __init__(self):
        self.recognizer = cv2.face.LBPHFaceRecognizer_create()
        self.names_map = {}
        self.ready = False
        self.lock = threading.Lock()

dir_recognizers = {}                 # dir_path -> DirRecognizer
dir_recognizers_lock = threading.Lock()

def get_recognizer(dir_path):
    with dir_recognizers_lock:
        rec = dir_recognizers.get(dir_path)
        if rec is None:
            rec = DirRecognizer()
            dir_recognizers[dir_path] = rec
        return rec


def train_recognizer(dir_path):
    if not dir_path or not os.path.isdir(dir_path):
        return
    rec = get_recognizer(dir_path)
    faces, labels, name_to_label, next_id = [], [], {}, [0]

    def get_label(base):
        if base not in name_to_label:
            name_to_label[base] = next_id[0]
            next_id[0] += 1
        return name_to_label[base]

    for fname in sorted(os.listdir(dir_path)):
        if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        p = os.path.join(dir_path, fname)
        img_bgr = cv2.imread(p)
        if img_bgr is None: continue
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        rgb  = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        stem = os.path.splitext(fname)[0]
        base = re.sub(r'_\d+$', '', stem)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        with face_detector_lock:
            result = shared_face_detector.detect(mp_img)
        if result.detections:
            bb = result.detections[0].bounding_box
            ih, iw = gray.shape
            x = max(0, bb.origin_x); y = max(0, bb.origin_y)
            w = min(bb.width, iw - x); h = min(bb.height, ih - y)
            crop = gray[y:y+h, x:x+w]
            if crop.size > 0:
                faces.append(cv2.resize(crop, (120, 120)))
                labels.append(get_label(base))
        else:
            log({'type': 'warning', 'message': f'No face in enrollment: {fname}'})

    with rec.lock:
        if faces:
            rec.recognizer.train(faces, np.array(labels))
            rec.names_map = {v: k.replace('_', ' ') for k, v in name_to_label.items()}
            rec.ready = True
        else:
            rec.ready = False


# ── Per-stream thread ─────────────────────────────────────────
active_streams = {}

def stream_worker(stream_id, rtsp_url, enrollment_dir):
    stop_event = active_streams[stream_id]['stop']
    log({'type': 'info', 'message': f'Stream worker started: {stream_id} (enroll dir: {enrollment_dir})'})
    enrolled_mtime = 0
    cap = None
    frame_idx = 0
    last_frame_at = 0  # wall-clock time of last successful frame

    # For incident heuristics (e.g. fight)
    person_history = collections.deque(maxlen=10) # Track person counts/locations

    # Temporal stability for face recognition. Per-slot we track the last
    # candidate name and a streak counter; only emit a name once the streak
    # passes RECOGNITION_CONFIRM_FRAMES. We slot by face-box centroid bucket
    # so different people in the frame don't share a streak.
    name_streaks = {}  # bucket -> {'name': str, 'count': int}

    while not stop_event.is_set():
        if cap is None or not cap.isOpened():
            if cap: cap.release()
            cap = cv2.VideoCapture(rtsp_url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1) # Reduce lag by minimizing buffer
            if not cap.isOpened():
                time.sleep(2); continue
            last_frame_at = time.time()

        # If reads have been silently failing/blocked for too long, force a recycle.
        if last_frame_at and (time.time() - last_frame_at) > 10:
            log({'type': 'warning', 'message': f'No frames for 10s on {stream_id}, reopening capture'})
            cap.release(); cap = None; time.sleep(1); continue

        ret, frame = cap.read()
        if not ret:
            cap.release(); cap = None; time.sleep(1); continue
        last_frame_at = time.time()

        frame_idx += 1
        if frame_idx % FRAME_SKIP != 0: continue

        # Downscale for performance (significant CPU saving)
        small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        h, w = small_frame.shape[:2]
        rgb = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # Auto-retrain when this user's enrollment dir changes
        if enrollment_dir and os.path.isdir(enrollment_dir):
            try:
                mtime = os.path.getmtime(enrollment_dir)
                if mtime != enrolled_mtime:
                    enrolled_mtime = mtime
                    train_recognizer(enrollment_dir)
            except: pass

        rec = get_recognizer(enrollment_dir) if enrollment_dir else None

        # 1. Face Detection & Recognition
        detections = []
        try:
            with face_detector_lock:
                result = shared_face_detector.detect(mp_img)
            if result.detections:
                gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                seen_buckets = set()
                for d in result.detections:
                    bb = d.bounding_box
                    name = None

                    # Skip recognition for very small faces — LBPH on tiny crops
                    # produces near-random matches.
                    face_area_ratio = (bb.width * bb.height) / float(w * h)

                    if rec is not None and face_area_ratio >= MIN_FACE_AREA_RATIO:
                        with rec.lock:
                            if rec.ready:
                                x = max(0, bb.origin_x); y = max(0, bb.origin_y)
                                fw = min(bb.width, w - x); fh = min(bb.height, h - y)
                                crop = gray[y:y+fh, x:x+fw]
                                if crop.size > 0:
                                    crop = cv2.resize(crop, (120, 120))
                                    label, dist = rec.recognizer.predict(crop)
                                    if dist < RECOGNITION_THRESHOLD:
                                        candidate = rec.names_map.get(label)
                                        # Temporal smoothing: bucket by face-centroid (~10% grid)
                                        cx = (bb.origin_x + bb.width / 2) / w
                                        cy = (bb.origin_y + bb.height / 2) / h
                                        bucket = (round(cx * 10), round(cy * 10))
                                        seen_buckets.add(bucket)
                                        s = name_streaks.get(bucket)
                                        if s and s['name'] == candidate:
                                            s['count'] += 1
                                        else:
                                            name_streaks[bucket] = {'name': candidate, 'count': 1}
                                            s = name_streaks[bucket]
                                        if s['count'] >= RECOGNITION_CONFIRM_FRAMES:
                                            name = candidate
                    detections.append({
                        'x': bb.origin_x / w, 'y': bb.origin_y / h,
                        'w': bb.width / w,    'h': bb.height / h,
                        'confidence': float(d.categories[0].score if d.categories else 0),
                        'label': 'face', 'name': name,
                    })

                # Drop streak slots that nobody held this frame so we don't
                # keep a stale name alive after a person leaves the scene.
                for bucket in list(name_streaks.keys()):
                    if bucket not in seen_buckets:
                        del name_streaks[bucket]
        except Exception as ex:
            log({'type': 'warning', 'message': f'Face detect error: {ex}'})

        # 2. YOLO Incident Detection (General Objects + Heuristics)
        incidents = []
        try:
            with yolo_lock:
                # Run YOLOv8 on small frame
                yolo_results = yolo_model(small_frame, verbose=False)[0]
                
                people = []
                for box in yolo_results.boxes:
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    if conf < 0.6: continue # Increased from 0.3 to reduce false persons
                    
                    label = yolo_model.names[cls_id]
                    bx = box.xyxyn[0].tolist() # [x1, y1, x2, y2]
                    
                    if label == 'person':
                        # Ignore very small boxes that are likely false positives (hands, etc.)
                        bw = bx[2] - bx[0]
                        bh = bx[3] - bx[1]
                        if bw * bh < 0.05: continue 
                        
                        people.append(bx)
                        detections.append({
                            'x': bx[0], 'y': bx[1], 'w': bw, 'h': bh,
                            'confidence': conf, 'label': 'person'
                        })
                    elif label in ['fire', 'smoke']: # In case custom model is used or standard detects them
                        incidents.append({'type': 'fire', 'confidence': conf, 'box': bx})

                # If we have a dedicated fire model, run it
                if fire_model:
                    f_results = fire_model(frame, verbose=False)[0]
                    for box in f_results.boxes:
                        if float(box.conf[0]) > 0.4:
                            bx = box.xyxyn[0].tolist()
                            incidents.append({'type': 'fire', 'confidence': float(box.conf[0]), 'box': bx})
                else:
                    # Fallback: Color-based detection for small flames (lighters, etc.)
                    # Look for bright orange/red pixels in HSV space
                    hsv = cv2.cvtColor(small_frame, cv2.COLOR_BGR2HSV)
                    # Narrow range: Intense Orange/Red only
                    lower_fire = np.array([0, 150, 200], dtype="uint8")
                    upper_fire = np.array([15, 255, 255], dtype="uint8")
                    mask = cv2.inRange(hsv, lower_fire, upper_fire)
                    
                    # Clean up mask (Dilation to merge close sparks)
                    mask = cv2.dilate(mask, None, iterations=2)
                    mask = cv2.GaussianBlur(mask, (5, 5), 0)
                    
                    # Find contours
                    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    for cnt in contours:
                        area = cv2.contourArea(cnt)
                        if area > 250: # Increased threshold from 100
                            x, y, w_cnt, h_cnt = cv2.boundingRect(cnt)
                            # Shape check: Flames are usually taller than wide or square-ish
                            if h_cnt / w_cnt > 0.5: 
                                incidents.append({
                                    'type': 'fire', 
                                    'confidence': 0.9, 
                                    'box': [x/w, y/h, (x+w_cnt)/w, (y+h_cnt)/h]
                                })
                                break 

        except Exception as ex:
            log({'type': 'warning', 'message': f'YOLO error: {ex}'})

        log({'type': 'detections', 'streamId': stream_id, 'detections': detections, 'incidents': incidents})

    if cap: cap.release()
    log({'type': 'info', 'message': f'Stream worker stopped: {stream_id}'})


def main():
    log({'type': 'ready', 'message': 'Multi-stream worker ready (per-user recognizers)'})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw: continue
        try:
            cmd = json.loads(raw)
        except: continue

        action = cmd.get('cmd')
        if action == 'add':
            sid = cmd['streamId']
            url = cmd['rtspUrl']
            # Falls back to the legacy single-tenant root for older callers.
            enroll_dir = cmd.get('enrollmentDir') or ENROLLMENT_DIR
            if sid not in active_streams:
                stop_ev = threading.Event()
                active_streams[sid] = {'stop': stop_ev}
                t = threading.Thread(target=stream_worker, args=(sid, url, enroll_dir), daemon=True)
                t.start()
                active_streams[sid]['thread'] = t
        elif action == 'remove':
            sid = cmd.get('streamId')
            if sid in active_streams:
                active_streams[sid]['stop'].set()
                del active_streams[sid]
        elif action == 'quit':
            for info in active_streams.values(): info['stop'].set()
            break

if __name__ == '__main__':
    main()
