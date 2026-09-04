"""
Automated cloud/sky detection using image statistics.

A cloud/sky-only image has:
- Very high brightness (mean > 200 in all channels)
- Very low standard deviation (uniform texture)
- Blue/white dominant color
- No dark skin-tone pixels

This gives us an objective classification that we can then manually verify.
"""
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    os.system(f"{sys.executable} -m pip install Pillow numpy -q")
    import numpy as np
    from PIL import Image

EVIDENCE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "evidence")

def classify_image(path):
    """
    Returns: (classification, reason, stats_dict)
    classifications: REAL_HUMAN, CLOUD_BACKGROUND_ONLY, UNCERTAIN
    """
    try:
        img = Image.open(path).convert('RGB')
        arr = np.array(img, dtype=np.float32)
        
        h, w = arr.shape[:2]
        r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
        
        # Whole image stats
        mean_r = float(r.mean())
        mean_g = float(g.mean())
        mean_b = float(b.mean())
        mean_all = float(arr.mean())
        std_all = float(arr.std())
        
        # Check for very bright (sky/cloud) regions
        bright_mask = (r > 210) & (g > 210) & (b > 210)
        bright_pct = float(bright_mask.sum()) / (h * w)
        
        # Check for sky-blue (high blue, lower red/green)
        sky_blue_mask = (b > 150) & (b > r + 20) & (b > g + 10)
        sky_blue_pct = float(sky_blue_mask.sum()) / (h * w)
        
        # Check for skin-tone pixels (dark or medium skin: brown range)
        # Skin tone: R > G > B, with R in 80-220, B < 180
        skin_mask = (r > 60) & (r > g) & (g > b) & (b < 180) & (r < 250)
        skin_pct = float(skin_mask.sum()) / (h * w)
        
        # Check for dark pixels (people often have dark clothing/hair)
        dark_mask = (r < 80) & (g < 80) & (b < 80)
        dark_pct = float(dark_mask.sum()) / (h * w)
        
        stats = {
            "mean_r": round(mean_r, 1),
            "mean_g": round(mean_g, 1),
            "mean_b": round(mean_b, 1),
            "mean_all": round(mean_all, 1),
            "std_all": round(std_all, 1),
            "bright_pct": round(bright_pct * 100, 1),
            "sky_blue_pct": round(sky_blue_pct * 100, 1),
            "skin_pct": round(skin_pct * 100, 1),
            "dark_pct": round(dark_pct * 100, 1),
        }
        
        # Cloud/sky classification rules:
        # 1. Very bright overall (> 190 mean) AND very high bright % (> 70%) AND almost no skin tone
        # 2. Very low std (uniform texture < 30) AND very bright
        is_cloud = False
        cloud_reasons = []
        
        if mean_all > 185 and bright_pct > 0.65 and skin_pct < 0.03:
            is_cloud = True
            cloud_reasons.append(f"Very bright image (mean={mean_all:.0f}, bright%={bright_pct*100:.0f}%), minimal skin tones ({skin_pct*100:.1f}%)")
        
        if std_all < 35 and mean_all > 170:
            is_cloud = True
            cloud_reasons.append(f"Uniform texture (std={std_all:.0f}) AND bright (mean={mean_all:.0f}) — no detailed structure")
        
        # If significant skin tone or dark pixels → definitely has human content
        if skin_pct > 0.05 or dark_pct > 0.08:
            is_cloud = False  # Override — humans present
        
        if is_cloud:
            return "CLOUD_BACKGROUND_ONLY", "; ".join(cloud_reasons), stats
        else:
            return "REAL_HUMAN", f"skin%={skin_pct*100:.1f}%, dark%={dark_pct*100:.1f}%, std={std_all:.0f}", stats
    
    except Exception as e:
        return "ERROR", str(e), {}


def main():
    files = sorted([f for f in os.listdir(EVIDENCE_DIR) if f.endswith('.jpg')])
    print(f"Total evidence images: {len(files)}")
    print()
    
    cloud_files = []
    uncertain_files = []
    
    for fname in files:
        fpath = os.path.join(EVIDENCE_DIR, fname)
        cls, reason, stats = classify_image(fpath)
        
        flag = "CLOUD" if cls == "CLOUD_BACKGROUND_ONLY" else ("UNCRT" if cls == "UNCERTAIN" else "HUMAN")
        print(f"{flag} | {fname}")
        print(f"       reason: {reason}")
        if stats:
            print(f"       stats:  mean={stats.get('mean_all')}, std={stats.get('std_all')}, skin%={stats.get('skin_pct')}, dark%={stats.get('dark_pct')}, bright%={stats.get('bright_pct')}")
        print()
        
        if cls == "CLOUD_BACKGROUND_ONLY":
            cloud_files.append((fname, reason, stats))
        elif cls == "UNCERTAIN":
            uncertain_files.append((fname, reason, stats))
    
    print("=" * 60)
    print(f"SUMMARY:")
    print(f"  Total images:           {len(files)}")
    print(f"  CLOUD_BACKGROUND_ONLY:  {len(cloud_files)}")
    print(f"  UNCERTAIN:              {len(uncertain_files)}")
    print(f"  REAL_HUMAN/OTHER:       {len(files) - len(cloud_files) - len(uncertain_files)}")
    print()
    if cloud_files:
        print("CLOUD IMAGES FOUND:")
        for fname, reason, stats in cloud_files:
            print(f"  {fname}: {reason}")


if __name__ == "__main__":
    main()
