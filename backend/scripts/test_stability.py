"""
Test the position stability logic against real TRK#2 history and a smooth walking scenario.
"""
import sys
sys.path.insert(0, 'e:/IBVAP/backend')

real_trk2_history = [
    {"x": 0.068, "y": 0.216, "width": 0.283, "height": 0.760},
    {"x": 0.000, "y": 0.038, "width": 0.220, "height": 0.953},
    {"x": 0.001, "y": 0.643, "width": 0.128, "height": 0.353},
    {"x": 0.777, "y": 0.235, "width": 0.208, "height": 0.711},
    {"x": 0.078, "y": 0.253, "width": 0.193, "height": 0.707},
    {"x": 0.002, "y": 0.646, "width": 0.134, "height": 0.350},
    {"x": 0.109, "y": 0.192, "width": 0.284, "height": 0.788},
    {"x": 0.008, "y": 0.002, "width": 0.228, "height": 0.981},
    {"x": 0.002, "y": 0.044, "width": 0.219, "height": 0.949},
    {"x": 0.048, "y": 0.240, "width": 0.196, "height": 0.715},
    {"x": 0.002, "y": 0.054, "width": 0.216, "height": 0.939},
    {"x": 0.000, "y": 0.641, "width": 0.126, "height": 0.354},
    {"x": 0.811, "y": 0.240, "width": 0.189, "height": 0.737},
    {"x": 0.001, "y": 0.651, "width": 0.144, "height": 0.346},
]

def stability_check(history):
    if len(history) < 3:
        return True, ""
    
    widths = [b["width"] for b in history]
    heights = [b["height"] for b in history]
    
    w_range = max(widths) - min(widths)
    h_range = max(heights) - min(heights)
    avg_w = sum(widths) / len(widths)
    avg_h = sum(heights) / len(heights)
    
    # Per-frame displacement check (velocity)
    max_x_step = 0.0
    max_y_step = 0.0
    for i in range(1, len(history)):
        cx_prev = history[i-1]["x"] + history[i-1]["width"] / 2
        cy_prev = history[i-1]["y"] + history[i-1]["height"] / 2
        cx_curr = history[i]["x"] + history[i]["width"] / 2
        cy_curr = history[i]["y"] + history[i]["height"] / 2
        max_x_step = max(max_x_step, abs(cx_curr - cx_prev))
        max_y_step = max(max_y_step, abs(cy_curr - cy_prev))
    
    # Check width variance
    if avg_w > 0 and (w_range / avg_w) > 0.6:
        return False, f"Unstable Width (w_range={w_range:.3f}, avg_w={avg_w:.3f}, ratio={w_range/avg_w:.2f})"
    # Check height variance
    if avg_h > 0 and (h_range / avg_h) > 0.6:
        return False, f"Unstable Height (h_range={h_range:.3f}, avg_h={avg_h:.3f}, ratio={h_range/avg_h:.2f})"
    # Check single-frame jump (>25% is implausible for real person)
    if max_x_step > 0.25 or max_y_step > 0.25:
        return False, f"Sudden Jump (max_x_step={max_x_step:.3f}, max_y_step={max_y_step:.3f})"
    
    return True, "Stable"

# Test 1: Real TRK#2 cloud incident
stable, reason = stability_check(real_trk2_history)
print(f"TRK#2 Cloud: stable={stable}, reason={reason}")

# Test 2: Smooth walker across large portion of frame
smooth_walker = [
    {"x": 0.10, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.15, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.20, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.25, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.30, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.35, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.40, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.45, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.50, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.55, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.60, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.65, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.70, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.75, "y": 0.50, "width": 0.15, "height": 0.40},
]
stable, reason = stability_check(smooth_walker)
xs = [b["x"] for b in smooth_walker]
print(f"Smooth Walker: stable={stable}, x_range={max(xs)-min(xs):.2f}, reason={reason}")

# Test 3: False detector jumping violently
jumper = [
    {"x": 0.05, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.85, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.05, "y": 0.50, "width": 0.15, "height": 0.40},
    {"x": 0.80, "y": 0.50, "width": 0.15, "height": 0.40},
]
stable, reason = stability_check(jumper)
xs = [b["x"] for b in jumper]
print(f"Jumper: stable={stable}, x_range={max(xs)-min(xs):.2f}, reason={reason}")
