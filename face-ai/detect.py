import sys
import os
import json
import time
import cv2
from ultralytics import YOLO

try:
    import face_recognition
    FACE_REC_AVAILABLE = True
except Exception:
    FACE_REC_AVAILABLE = False

HERE = os.path.dirname(os.path.abspath(__file__))
ENROLLMENT_DIR = os.path.join(HERE, 'enrollments')
FRAME_SKIP = 3
PERSON_CONF = 0.4
FACE_MATCH_THRESHOLD = 0.6


def log(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def pick_weights():
    # Prefer face-specific weights if present, otherwise COCO. If neither file
    # exists, returning the bare name lets ultralytics auto-download from the hub.
    candidates = [
        os.path.join(HERE, 'yolov8n-face.pt'),
        'yolov8n-face.pt',
        os.path.join(HERE, '..', 'yolov8n.pt'),
        'yolov8n.pt',
    ]
    for c in candidates:
        if os.path.exists(c) and os.path.getsize(c) > 1024:
            return c
    return 'yolov8n.pt'


def load_enrollments():
    encodings, names = [], []
    if not FACE_REC_AVAILABLE or not os.path.isdir(ENROLLMENT_DIR):
        return encodings, names
    for fname in sorted(os.listdir(ENROLLMENT_DIR)):
        if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        p = os.path.join(ENROLLMENT_DIR, fname)
        try:
            img = face_recognition.load_image_file(p)
            encs = face_recognition.face_encodings(img)
            if encs:
                encodings.append(encs[0])
                names.append(os.path.splitext(fname)[0])
            else:
                log({'type': 'warning', 'message': f'no face found in enrollment {fname}'})
        except Exception as ex:
            log({'type': 'warning', 'message': f'failed to load enrollment {fname}: {ex}'})
    return encodings, names


def main():
    if len(sys.argv) < 3:
        log({'type': 'error', 'message': 'usage: detect.py <rtsp_url> <stream_id>'})
        return

    rtsp_url = sys.argv[1]
    stream_id = sys.argv[2]

    weights = pick_weights()
    try:
        model = YOLO(weights)
    except Exception as ex:
        log({'type': 'error', 'message': f'YOLO load failed: {ex}'})
        return

    # Face-specific YOLO weights expose one class; COCO weights expose 80 with
    # person == 0. The downstream logic branches on this.
    is_face_model = len(model.names) == 1

    if not FACE_REC_AVAILABLE:
        log({'type': 'warning',
             'message': 'face_recognition not installed — name matching disabled; '
                        'pip install face_recognition to enable'})

    enrollments, names = load_enrollments()
    enrolled_mtime = os.path.getmtime(ENROLLMENT_DIR) if os.path.isdir(ENROLLMENT_DIR) else 0

    cap = None
    frame_idx = 0

    while True:
        if cap is None or not cap.isOpened():
            if cap is not None:
                cap.release()
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                log({'type': 'warning', 'message': 'RTSP open failed; retry in 2s'})
                time.sleep(2)
                continue

        ret, frame = cap.read()
        if not ret:
            log({'type': 'warning', 'message': 'frame read failed; reconnecting'})
            cap.release()
            cap = None
            time.sleep(2)
            continue

        frame_idx += 1
        if frame_idx % FRAME_SKIP != 0:
            continue

        if FACE_REC_AVAILABLE and os.path.isdir(ENROLLMENT_DIR):
            m = os.path.getmtime(ENROLLMENT_DIR)
            if m != enrolled_mtime:
                enrollments, names = load_enrollments()
                enrolled_mtime = m

        h, w = frame.shape[:2]

        try:
            result = model.predict(frame, conf=PERSON_CONF, verbose=False)[0]
        except Exception as ex:
            log({'type': 'warning', 'message': f'YOLO predict failed: {ex}'})
            continue

        detections = []
        rgb = None

        for box in result.boxes:
            cls = int(box.cls[0])
            if not is_face_model and cls != 0:  # keep only 'person' on COCO model
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]

            matched_name = None
            if FACE_REC_AVAILABLE and enrollments:
                if rgb is None:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                if is_face_model:
                    face_locs = [(int(y1), int(x2), int(y2), int(x1))]
                else:
                    # Search only the upper half of the person box to keep cost down.
                    top_cut = max(0, int(y1))
                    bot_cut = min(h, int(y1 + (y2 - y1) * 0.5))
                    left_cut = max(0, int(x1))
                    right_cut = min(w, int(x2))
                    crop = rgb[top_cut:bot_cut, left_cut:right_cut]
                    if crop.size == 0:
                        face_locs = []
                    else:
                        locs = face_recognition.face_locations(crop, model='hog')
                        face_locs = [(t + top_cut, r + left_cut,
                                      b + top_cut, l + left_cut)
                                     for (t, r, b, l) in locs]

                if face_locs:
                    try:
                        encs = face_recognition.face_encodings(rgb, face_locs)
                        if encs:
                            dists = face_recognition.face_distance(enrollments, encs[0])
                            best = int(dists.argmin())
                            if float(dists[best]) < FACE_MATCH_THRESHOLD:
                                matched_name = names[best]
                    except Exception:
                        pass

            detections.append({
                'x': x1 / w,
                'y': y1 / h,
                'w': (x2 - x1) / w,
                'h': (y2 - y1) / h,
                'confidence': conf,
                'label': 'face' if is_face_model else 'person',
                'name': matched_name,
            })

        log({'type': 'detections', 'streamId': stream_id, 'detections': detections})


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
