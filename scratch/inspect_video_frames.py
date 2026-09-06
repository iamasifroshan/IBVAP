import os
import cv2
import numpy as np

f1 = "backend/storage/videos/test_sample_h264.mp4"
f2 = "backend/storage/videos/gettyimages-2215078536-640_adpp.mp4"

for f in [f1, f2]:
    if os.path.exists(f):
        cap = cv2.VideoCapture(f)
        ret, frame = cap.read()
        cap.release()
        if ret:
            # Check frame variance / mean
            mean = np.mean(frame)
            std = np.std(frame)
            print(f"File: {f}")
            print(f"  Frame shape: {frame.shape}, Mean: {mean:.2f}, Std: {std:.2f}")
            # Check if frame looks like synthetic noise
            is_noise = std > 70 and abs(mean - 127) < 15
            print(f"  Is random noise: {is_noise}")
        else:
            print(f"File: {f} failed to read first frame")
    else:
        print(f"File: {f} does not exist")
