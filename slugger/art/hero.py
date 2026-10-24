# Slugger hero (Rayo) sprite pipeline: builds the character in Blender from primitives, poses it with
# the same skeleton as js/soldier.js, renders each pose with Cycles (part-id, normal and depth passes,
# one sample at the pixel centre, so no anti-aliasing), then bakes 4-level toon shading and interior
# depth lines into palette-indexed frames and writes them to js/hero_art.js.
#
# Run from the repo root:  python3 slugger/art/hero.py  [--preview out.png] [--no-base]
# Needs the bpy module (pip install bpy). Units: 1 Blender unit = 1 hi-res sprite pixel (2 per world px).
# Axes: +X forward (the hero faces right), +Z up, -Y toward the camera (near side).
import bpy, bmesh, math, os, sys, json, base64, struct, zlib
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = "/tmp/slugger_hero"
os.makedirs(TMP, exist_ok=True)

# ---------- part ids: palette key (costume colours) or fixed colour, exported to JS ----------
IDS = [
    ("S", None), ("s", None), ("H", None), ("A", None), ("C", None), ("c", None), ("D", None),
    ("P", None), ("p", None), ("B", None), ("b", None), ("K", None), ("N", None), ("n", None),
    (None, "#ffffff"), (None, "#1a1010"), (None, "#34343e"), (None, "#565664"), (None, "#9c9cac"),
    (None, "#6a4520"), (None, "#5d6b32"), (None, "#3e4822"), (None, "#ff8a1a"), (None, "#c83a2a"),
    (None, "#8fd0e8"), (None, "#e8c050"), (None, "#e8e8f0"), (None, "#1a1210"), (None, "#a8743a"),
    (None, "#e6f6ff"), (None, "#8a4a3a"),
]
I = {}
for n, (k, hx) in enumerate(IDS): I[k or hx] = n
SKIN, SKIN_D, HAIR, GEAR, SHIRT, SHIRT_D, SHIRT_L = I["S"], I["s"], I["H"], I["A"], I["C"], I["c"], I["D"]
PANTS, PANTS_D, BOOT, BOOT_L, BELT, PACK, PACK_D = I["P"], I["p"], I["B"], I["b"], I["K"], I["N"], I["n"]
WHITE, PUPIL, G_DARK, G_MID, G_LIGHT = I["#ffffff"], I["#1a1010"], I["#34343e"], I["#565664"], I["#9c9cac"]
WOOD, OLIVE, OLIVE_D, ORANGE, RED, LASER = I["#6a4520"], I["#5d6b32"], I["#3e4822"], I["#ff8a1a"], I["#c83a2a"], I["#8fd0e8"]
BRASS, STEEL, SOLE, PUMP, LASER_TIP, LIP = I["#e8c050"], I["#e8e8f0"], I["#1a1210"], I["#a8743a"], I["#e6f6ff"], I["#8a4a3a"]

# ---------- mesh building (one bmesh per frame, part id + far flag as face attributes) ----------
class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.pid = self.bm.faces.layers.float.new("pid")
        self.far = self.bm.faces.layers.float.new("far")
    def _tag(self, geom, pid, far, smooth=True):
        faces = set()
        for v in geom:
            if isinstance(v, bmesh.types.BMVert): faces.update(v.link_faces)
        for f in faces:
            f[self.pid] = pid; f[self.far] = 1.0 if far else 0.0; f.smooth = smooth
    def sphere(self, c, r, pid, far=False, scale=(1, 1, 1), rot=None, seg=20):
        m = Matrix.Translation(Vector(c)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((r * scale[0], r * scale[1], r * scale[2], 1))
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=seg // 2 + 2, radius=1, matrix=m)
        self._tag(ret["verts"], pid, far)
    def cyl(self, a, b, r1, r2, pid, far=False, seg=16, squash=1.0, smooth=True):
        a, b = Vector(a), Vector(b); d = b - a; L = d.length
        if L < 1e-4: return
        z = d.normalized(); up = Vector((0, 1, 0)) if abs(z.y) < 0.9 else Vector((1, 0, 0))
        x = up.cross(z).normalized(); y = z.cross(x)
        rot = Matrix((x, y, z)).transposed().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((1, squash, 1, 1))
        ret = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=L, matrix=m)
        self._tag(ret["verts"], pid, far, smooth)
    def capsule(self, a, b, r, pid, far=False, r2=None, squash=1.0):
        r2 = r if r2 is None else r2
        self.cyl(a, b, r, r2, pid, far, squash=squash)
        self.sphere(a, r, pid, far, scale=(1, squash, 1)); self.sphere(b, r2, pid, far, scale=(1, squash, 1))
    def tris(self, co, tris, pids, fars):
        vs = [self.bm.verts.new(c) for c in co.tolist()]
        for (a, b, c), pid, far in zip(tris.tolist(), pids, fars):
            try: f = self.bm.faces.new((vs[a], vs[b], vs[c]))
            except ValueError: continue
            f[self.pid] = pid; f[self.far] = 1.0 if far else 0.0; f.smooth = True
        loose = [v for v in vs if not v.link_faces]
        if loose: bmesh.ops.delete(self.bm, geom=loose, context="VERTS")
    def finish(self, name="hero"):
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free()
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(bpy.data.materials["M"])
        return ob

def _box(self, lo, hi, pid, far=False, bevel=0.3, about=None, ang=0.0):   # bevelled box, optionally turned about (x, z)
    lo, hi = Vector(lo), Vector(hi); c = (lo + hi) / 2; s = hi - lo
    m = Matrix.Translation(c) @ Matrix.Diagonal((s.x, s.y, s.z, 1))
    if about is not None:
        p = Vector((about[0], 0, about[1]))
        m = Matrix.Translation(p) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Translation(-p) @ m
    before = set(self.bm.faces)
    bmesh.ops.create_cube(self.bm, size=1, matrix=m)
    new = [f for f in self.bm.faces if f not in before]
    if bevel > 0:
        edges = list({e for f in new for e in f.edges})
        bmesh.ops.bevel(self.bm, geom=edges, offset=min(bevel, min(s) * 0.3), segments=1, affect="EDGES", profile=0.5)
        new = [f for f in self.bm.faces if f not in before]
    for f in new:
        f[self.pid] = pid; f[self.far] = 1.0 if far else 0.0; f.smooth = False
Mesh.box = _box

# ---------- skeleton (mirrors js/soldier.js) ----------
def bend(a, b, L1, L2, down):   # two-bone IK, same as soldier.js: down = joint below the line, else in front
    dx, dy = b[0] - a[0], b[1] - a[1]; d = math.hypot(dx, dy) or 0.01
    maxd = L1 + L2 - 0.05
    if d > maxd: b = (a[0] + dx / d * maxd, a[1] + dy / d * maxd); dx, dy = b[0] - a[0], b[1] - a[1]; d = maxd
    p = (L1 * L1 - L2 * L2 + d * d) / (2 * d); h = math.sqrt(max(0, L1 * L1 - p * p))
    nx, ny = -dy / d, dx / d
    if (ny > 0) if down else (nx < 0): nx, ny = -nx, -ny
    return (a[0] + dx * p / d + nx * h, a[1] + dy * p / d + ny * h), b

def skeleton(pose, fr=0):
    s = {"lean": 0}
    if pose == "run":
        ph = fr / 12 * math.tau
        s["hip"] = (0, 17.5 + (1 - math.cos(2 * ph)) * 1.2); s["lean"] = 2
        foot = lambda th: (9.5 * math.cos(th), max(0, -math.sin(th)) * 8)
        s["near"] = {"foot": foot(ph)}; s["far"] = {"foot": foot(ph + math.pi)}
    elif pose == "cwalk":   # duck walk: deep squat, short shuffling steps
        ph = fr / 8 * math.tau
        s["hip"] = (0, 10.5 + (1 - math.cos(2 * ph)) * 0.5); s["lean"] = 1.5
        foot = lambda th, x0: (x0 + 4.5 * math.cos(th), max(0, -math.sin(th)) * 3)
        s["near"] = {"foot": foot(ph, 7)}; s["far"] = {"foot": foot(ph + math.pi, -5)}
    elif pose == "jump": s["hip"] = (0, 19); s["near"] = {"foot": (7, 7)}; s["far"] = {"foot": (-5, 1)}       # take-off: lead knee up, trail leg pushing
    elif pose == "apex": s["hip"] = (0, 20); s["near"] = {"foot": (6, 11)}; s["far"] = {"foot": (1, 9)}       # top of the jump: both knees tucked
    elif pose == "fall": s["hip"] = (0, 19); s["near"] = {"foot": (4, 1.5)}; s["far"] = {"foot": (-3, 3.5)}   # legs reach down for the landing
    elif pose == "crouch": s["hip"] = (0, 10); s["near"] = {"foot": (9, 0)}; s["far"] = {"knee": (-3, 1.5), "foot": (-13, 1.5)}; s["lean"] = 1
    elif pose == "roll": s["hip"] = (-1, 11); s["near"] = {"foot": (5, 4)}; s["far"] = {"foot": (3, 5.5)}     # tucked ball
    else: s["hip"] = (0, 19); s["near"] = {"foot": (4, 0)}; s["far"] = {"foot": (-4, 0)}
    return s

# canonical upper-body frame: hip at (0, 19), no lean (the game offsets it per pose)
HIP = (0.0, 19.0)
SH_N = (1.0, 32.0); SH_F = (-2.0, 32.0); HEAD = (2.5, 42.0)
YN, YF = -7.0, 6.5        # near / far arm depth

def X(p, y=0.0): return (p[0], y, p[1])

# ---------- base body: Mixamo "X Bot" mesh, re-posed onto the game skeleton ----------
# The suit shells (pelvis, thighs, shins, torso, upper arms, forearms) come from a real skinned body mesh
# instead of capsules. Each Mixamo bone gets an affine map from its rest frame to the matching segment of
# our 2D skeleton (length and thickness rescaled to the sprite's chunky proportions); the vertices are moved
# with linear blend skinning. Head, hands and feet stay ours (face, gloves, boots). The .glb is a Mixamo
# character from the three.js examples: it is fetched into TMP and never committed (Mixamo terms forbid
# redistributing the raw files). Run with --no-base to build the old all-primitive hero.
BASE_URL = "https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Xbot.glb"
BASE_SHA = "002f8d269de68e5dce3d25195caf390d1aa359bbfaae3fcf4c8dc78ec36c3ba5"
SEGS = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
        "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightUpLeg", "RightLeg", "RightFoot", "LeftUpLeg", "LeftLeg", "LeftFoot"]
SEG = {n: i for i, n in enumerate(SEGS)}
# segment -> (part id, far, half thickness in-plane, half thickness in depth); Right = near side (faces the camera)
LOOK = {"Hips": (PANTS, False, 6.6, 7.4), "Spine": (SHIRT, False, 6.8, 5.6), "Spine1": (SHIRT, False, 7.4, 6.1), "Spine2": (SHIRT, False, 7.8, 6.6),
        "RightShoulder": (SHIRT, False, 3.8, 3.8), "LeftShoulder": (SHIRT, True, 3.8, 3.8),
        "RightArm": (SHIRT, False, 3.3, 3.3), "LeftArm": (SHIRT, True, 3.3, 3.3), "RightForeArm": (SKIN, False, 2.7, 2.7), "LeftForeArm": (SKIN, True, 2.7, 2.7),
        "RightUpLeg": (PANTS, False, 4.1, 4.1), "LeftUpLeg": (PANTS, True, 4.1, 4.1), "RightLeg": (PANTS, False, 3.4, 3.4), "LeftLeg": (PANTS, True, 3.4, 3.4)}
for n in ("Neck", "Head", "RightHand", "LeftHand", "RightFoot", "LeftFoot"): LOOK[n] = (None, False, 3.0, 3.0)   # not drawn (ours)
LEG_SEGS = {"Hips", "RightUpLeg", "RightLeg", "LeftUpLeg", "LeftLeg"}
BODY = None

def _collapse(name):   # Mixamo bone -> our segment (fingers into the hand, toes into the foot, eyes into the head)
    n = name.split(":")[-1]
    for side in ("Left", "Right"):
        if n.startswith(side + "Hand"): return side + "Hand"
        if n.startswith(side + "Toe"): return side + "Foot"
    if n in ("HeadTop_End", "LeftEye", "RightEye"): return "Head"
    return n if n in SEG else None

def _frame(e, arm_rule):   # orthonormal frame (axis, in-plane normal, depth normal) for a bone axis
    e = e / np.linalg.norm(e); Y = np.array([0.0, 1.0, 0.0]); Xa = np.array([1.0, 0.0, 0.0])
    if arm_rule or abs(e @ Y) > 0.7: m = Xa - (Xa @ e) * e
    else: m = np.cross(e, Y)
    m /= np.linalg.norm(m)
    return np.stack([e, m, np.cross(e, m)], 1)

def load_base():
    """Import the X Bot body once, rest pose, rotated to our axes -> verts, tris, per-vertex top-4 weights, bone rest frames."""
    global BODY
    import hashlib, urllib.request
    path = f"{TMP}/Xbot.glb"
    if not os.path.exists(path) or hashlib.sha256(open(path, "rb").read()).hexdigest() != BASE_SHA:
        print("fetching", BASE_URL, flush=True); urllib.request.urlretrieve(BASE_URL, path)
        if hashlib.sha256(open(path, "rb").read()).hexdigest() != BASE_SHA: sys.exit("Xbot.glb checksum mismatch")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE"); arm.data.pose_position = "REST"
    ob = bpy.data.objects["Beta_Surface"]
    sm = ob.modifiers.new("smooth", "SMOOTH"); sm.factor = 0.8; sm.iterations = 6    # keep the big forms, drop detail below a sprite pixel
    dec = ob.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.3
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); me = ev.to_mesh()
    G = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]], float)       # rest faces -Y with its right at -X -> faces +X, right at -Y
    k = 27.0                                                          # metres -> hi px (only sets the working scale)
    mw = np.array(ob.matrix_world)
    co = np.array([v.co[:] for v in me.vertices]); co = (co @ mw[:3, :3].T + mw[:3, 3]) @ G.T * k
    me.calc_loop_triangles(); tris = np.array([t.vertices[:] for t in me.loop_triangles])
    gmap = {g.index: _collapse(g.name) for g in ob.vertex_groups}
    W = np.zeros((len(co), len(SEGS)))
    for v in me.vertices:
        for g in v.groups:
            s = gmap.get(g.group)
            if s: W[v.index, SEG[s]] += g.weight
    W /= np.maximum(W.sum(1, keepdims=True), 1e-6)
    ev.to_mesh_clear()
    joint = {b.name.split(":")[-1]: (np.array((arm.matrix_world @ b.head_local)[:]) @ G.T) * k for b in arm.data.bones}
    tail = {"Hips": "Spine", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head", "Head": "HeadTop_End"}
    for s in ("Left", "Right"):
        tail.update({s + "Shoulder": s + "Arm", s + "Arm": s + "ForeArm", s + "ForeArm": s + "Hand", s + "Hand": s + "HandMiddle1",
                     s + "UpLeg": s + "Leg", s + "Leg": s + "Foot", s + "Foot": s + "ToeBase"})
    rest = []
    for i, n in enumerate(SEGS):
        h0, t0 = joint[n], joint[tail[n]]
        F0 = _frame(t0 - h0, "Arm" in n or "Hand" in n or "Shoulder" in n)
        sel = W[:, i] > 0.35 if (W[:, i] > 0.35).sum() >= 12 else np.argsort(-W[:, i])[:40]   # weights spread on the spine
        loc = (co[sel] - h0) @ F0
        lo, hi = np.percentile(loc[:, 1:], 5, 0), np.percentile(loc[:, 1:], 95, 0)
        rest.append((h0, np.linalg.norm(t0 - h0), F0, (lo + hi) / 2, np.maximum((hi - lo) / 2, 0.05)))
    top = np.argsort(-W, 1)[:, :4]; tw = np.take_along_axis(W, top, 1); tw /= tw.sum(1, keepdims=True)
    tdom = W.argmax(1)[tris]; tseg = np.where(tdom[:, 1] == tdom[:, 2], tdom[:, 1], tdom[:, 0])   # majority vote per triangle
    BODY = dict(co=co, tris=tris, top=top, tw=tw, tseg=tseg, rest=rest)
    print("base body:", len(co), "verts,", len(tris), "tris", flush=True)

def body_targets(hip, legs_=None, arms=None, upper=False):
    """Full target skeleton {segment: (head xyz, tail xyz)}; missing limbs default to a standing pose."""
    hx, hz = hip; T = {}
    lean = 0.8 if upper else 0.0
    sp = [(hx, hz + 1.5), (hx + 0.1, hz + 4.5), (hx + 0.3, hz + 7.5), (hx + 0.5, hz + 10.3), (hx + lean, hz + 14.3), (hx + 1.5, hz + 18.0), (hx + 2.5, hz + 30.0)]
    for n, a, b in zip(("Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"), sp, sp[1:]): T[n] = (X(a), X(b))
    legs_ = legs_ or {}
    for side, y, near in (("Right", -3.6, "near"), ("Left", 3.6, "far")):
        knee, ankle, foot = legs_.get(near, ((hx + 0.5, hz - 9.6), (hx, hz - 15.8), (hx, hz - 19.0)))
        T[side + "UpLeg"] = (X((hx, hz), y), X(knee, y)); T[side + "Leg"] = (X(knee, y), X(ankle, y))
        T[side + "Foot"] = (X(ankle, y), X((foot[0] + 5, foot[1] + 1), y))
    arms = arms or {}
    for side, y, near, sh in (("Right", YN, "near", SH_N), ("Left", YF, "far", SH_F)):
        if not upper: sh = (sh[0] - HIP[0] + hx, sh[1] - HIP[1] + hz)
        el, h = arms.get(near, ((sh[0] - 0.5, sh[1] - 6.8), (sh[0], sh[1] - 13.2)))
        T[side + "Shoulder"] = ((sh[0] - 1.0, y * 0.2, sh[1] - 0.5), X(sh, y)); T[side + "Arm"] = (X(sh, y), X(el, y))
        T[side + "ForeArm"] = (X(el, y), X(h, y)); d = np.subtract(h, el); d = d / (np.linalg.norm(d) or 1)
        T[side + "Hand"] = (X(h, y), X((h[0] + d[0] * 2.5, h[1] + d[1] * 2.5), y))
    return T

def base_body(m, T, segs):
    """Skin the base mesh onto targets T and add the triangles of the given segments."""
    B = BODY; co = B["co"]; out = np.zeros_like(co)
    for i, n in enumerate(SEGS):
        h0, L0, F0, c0, r0 = B["rest"][i]; h1, t1 = np.array(T[n][0], float), np.array(T[n][1], float)
        L1 = np.linalg.norm(t1 - h1); F1 = _frame(t1 - h1, False)
        _, _, tm, td = LOOK[n]
        S = np.array([L1 / L0, tm / r0[0], td / r0[1]])
        sel = (B["top"] == i)
        if not sel.any(): continue
        rows = sel.any(1)
        loc = (co[rows] - h0) @ F0; loc[:, 1:] -= c0
        p = h1 + (loc * S) @ F1.T
        w = (B["tw"] * sel)[rows].sum(1, keepdims=True)
        out[rows] += w * p
    keep = np.isin(B["tseg"], [SEG[s] for s in segs if LOOK[s][0] is not None])
    m.tris(out, B["tris"][keep], [LOOK[SEGS[s]][0] for s in B["tseg"][keep]], [LOOK[SEGS[s]][1] for s in B["tseg"][keep]])

# ---------- body parts ----------
def legs(m, sk):
    hip = sk["hip"]; joints = {}
    for side, far in (("far", True), ("near", False)):
        L = sk[side]; y = 3.6 if far else -3.6
        if "knee" in L: knee, foot = L["knee"], L["foot"]
        else: knee, foot = bend(hip, L["foot"], 9.6, 9.4, False)
        ankle = (foot[0], foot[1] + 3.2); joints[side] = (knee, ankle, foot)
        if not BODY:
            m.capsule(X(hip, y), X(knee, y), 4.0, PANTS, far, r2=3.6)             # thigh
            m.capsule(X(knee, y), X(ankle, y), 3.5, PANTS, far, r2=3.0)           # shin
        mid = ((hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2)
        ang = math.atan2(knee[1] - hip[1], knee[0] - hip[0])
        m.box((mid[0] - 2.2, y - 4.3, mid[1] - 2.0), (mid[0] + 2.2, y - 2.6, mid[1] + 2.0), PANTS_D, far, about=mid, ang=ang + math.pi / 2)   # cargo pocket
        m.sphere(X(knee, y - 0.6), 3.4, PANTS_D, far, scale=(1, 1, 0.9))          # knee pad
        if not far:                                                                 # thigh holster
            m.box((mid[0] - 1.6, y - 5.4, mid[1] - 3.2), (mid[0] + 2.8, y - 3.4, mid[1] + 2.4), BELT, bevel=0.5, about=mid, ang=ang + math.pi / 2)
            m.box((mid[0] - 0.4, y - 6.0, mid[1] + 1.2), (mid[0] + 1.6, y - 4.8, mid[1] + 3.4), G_DARK, bevel=0.2, about=mid, ang=ang + math.pi / 2)
        fx, fy = foot
        m.box((fx - 3.8, y - 3.4, fy + 1.4), (fx + 6.4, y + 3.4, fy + 5.2), BOOT, far, bevel=1.2)   # boot
        m.box((fx - 4.0, y - 3.6, fy + 0.0), (fx + 6.8, y + 3.6, fy + 1.5), SOLE, far, bevel=0.4)    # sole
        m.box((fx - 3.2, y - 3.6, fy + 4.6), (fx + 2.6, y + 3.6, fy + 7.0), BOOT_L, far, bevel=0.6)  # cuff
        m.box((fx + 1.0, y - 3.7, fy + 2.4), (fx + 4.8, y - 3.3, fy + 2.9), BOOT_L, far, bevel=0)    # lace
    if BODY: base_body(m, body_targets(hip, joints), LEG_SEGS)                    # pelvis, thighs, shins

def torso(m):
    # sneaking-suit look: broad shoulders, ribbed suit, tactical harness with chest pouches, small back pouch
    hip = HIP
    if not BODY:
        m.capsule(X((hip[0], hip[1] + 2.5)), X((SH_N[0] - 0.5, SH_N[1] - 1.5)), 7.0, SHIRT, squash=0.82, r2=8.0)
        m.capsule(X((hip[0] + 2.5, hip[1] + 6)), X((SH_N[0] + 2.8, SH_N[1] - 3)), 3.4, SHIRT_L, squash=0.7)    # chest muscle sheen
    for z in (23.0, 26.0):                                                                                   # suit ribs
        m.box((-5.5, -6.4, z), (5.0, -5.6, z + 0.6), SHIRT_D, bevel=0)
    m.cyl(X((SH_N[0] - 2.5, SH_N[1] - 1.0)), X((SH_N[0] - 2.0, SH_N[1] + 1.2)), 4.6, 4.0, SHIRT_D, squash=0.85)   # turtleneck
    # harness: shoulder straps down the front, chest pouches, a radio on the strap
    m.capsule(X((SH_N[0] + 1.5, SH_N[1] - 0.5), -5.8), X((hip[0] + 4.5, hip[1] + 2.5), -5.8), 0.9, BELT)
    m.capsule(X((SH_N[0] - 3.5, SH_N[1] - 0.5), -5.6), X((hip[0] - 3.0, hip[1] + 2.5), -5.6), 0.9, BELT)
    m.capsule(X((SH_N[0] - 3.5, 27.5), -6.0), X((SH_N[0] + 2.0, 27.5), -6.0), 0.8, BELT)
    m.box((1.8, -7.6, 22.2), (5.2, -5.2, 26.0), BELT, bevel=0.5)                                              # pouch
    m.box((-2.6, -7.4, 22.4), (0.8, -5.2, 25.8), BELT, bevel=0.5)                                             # pouch
    m.box((1.9, -7.8, 25.2), (5.1, -6.8, 26.0), BOOT_L, bevel=0.1)                                            # flap
    m.box((-3.6, -8.0, 29.0), (-1.4, -6.4, 32.4), G_DARK, bevel=0.3)                                          # radio
    m.cyl((-3.0, -7.2, 32.4), (-3.4, -7.2, 35.0), 0.35, 0.3, G_DARK, seg=6)                                   # antenna
    m.cyl(X((hip[0], hip[1] - 0.6)), X((hip[0], hip[1] + 2.4)), 7.5, 7.5, BELT, squash=0.86, seg=20)        # belt
    m.box((5.6, -5.0, hip[1] - 0.4), (8.0, -2.0, hip[1] + 2.2), G_MID, bevel=0.3)                             # buckle
    m.box((-6.0, -6.6, hip[1] - 2.0), (-2.0, -5.0, hip[1] + 1.8), BELT, bevel=0.4)                            # belt pouch
    # small back pouch instead of a big pack
    m.box((-11.0, -3.5, 22.0), (-6.0, 3.5, 30.0), PACK, bevel=1.2)
    m.box((-11.6, -2.8, 24.0), (-9.6, 2.8, 28.5), PACK_D, bevel=0.5)

def head(m, panic=False):
    hx, hy = HEAD
    m.capsule(X((hx - 1.8, hy - 9)), X((hx - 0.6, hy - 5)), 3.2, SKIN)                                         # neck
    m.sphere(X((hx, hy)), 8.2, SKIN, scale=(1.0, 0.92, 1.0))                                                   # skull
    m.sphere(X((hx + 2.8, hy - 3.4)), 5.7, SKIN, scale=(1.05, 0.95, 0.9))                                      # square jaw
    m.sphere(X((hx + 3.2, hy - 4.9)), 5.6, SKIN_D, scale=(1.04, 1.0, 0.66))                                    # stubble
    m.sphere(X((hx + 8.7, hy - 1.2), -0.5), 1.7, SKIN, scale=(1.15, 1, 1.25))                                  # nose
    m.sphere(X((hx - 2.8, hy - 0.8), -7.0), 2.1, SKIN_D, scale=(0.8, 0.6, 1.1))                                # ear
    # narrowed eye under a heavy, angled brow
    m.sphere((hx + 5.5, -5.6, hy + 0.2), 1.8, WHITE, scale=(0.9, 0.5, 0.75))
    m.sphere((hx + 6.5, -6.2, hy + 0.1), 1.0, PUPIL, scale=(0.9, 0.5, 1.0))
    m.box((hx + 3.2, -7.0, hy + 1.6), (hx + 8.4, -5.4, hy + 3.0), HAIR, bevel=0.2, about=(hx + 5.8, hy + 2.3), ang=-0.18)
    if panic: m.box((hx + 4.2, -6.6, hy - 6.2), (hx + 7.4, -4.8, hy - 3.6), PUPIL, bevel=0.3)
    else: m.box((hx + 4.8, -6.6, hy - 5.0), (hx + 7.6, -4.8, hy - 4.4), LIP, bevel=0)
    # messy swept hair, longer at the back
    m.sphere(X((hx - 1.4, hy + 2.4)), 8.0, HAIR, scale=(1.0, 0.98, 0.92))
    for (ax, az, tx, tz, r) in ((-2, 7.5, -6, 10.5, 2.2), (2, 8, 0.5, 10.8, 2.0), (5, 6.5, 7.5, 8.0, 1.8), (-6, 5, -10, 6.5, 2.0)):
        m.cyl(X((hx + ax, hy + az)), X((hx + tx, hy + tz)), r, 0.6, HAIR)
    m.sphere(X((hx - 3.4, hy - 3.0), 0.0), 5.0, HAIR, scale=(1, 0.95, 1.15))                                   # back of the head
    m.capsule(X((hx - 6.0, hy - 2.0), 0.0), X((hx - 7.0, hy - 7.5), 0.0), 2.6, HAIR, r2=1.6)                    # hair down the nape
    m.sphere(X((hx + 4.0, hy + 4.4), -0.5), 2.2, HAIR, scale=(1.3, 0.9, 0.7))                                  # fringe over the brow
    # dark bandana knotted at the back, long tails flying
    m.cyl(X((hx - 0.6, hy + 2.6)), X((hx + 0.2, hy + 5.2)), 8.55, 8.35, GEAR, squash=0.95, seg=24)
    m.sphere(X((hx - 8.2, hy + 3.6), 0.5), 1.9, GEAR)
    m.capsule(X((hx - 8.6, hy + 3.4), 0.5), X((hx - 15.5, hy + 0.8), 0.9), 1.3, GEAR, r2=0.9, squash=0.6)
    m.capsule(X((hx - 15.5, hy + 0.8), 0.9), X((hx - 21.0, hy - 1.6), 1.2), 0.9, GEAR, r2=0.6, squash=0.6)
    m.capsule(X((hx - 8.6, hy + 3.0), 1.0), X((hx - 14.0, hy - 3.0), 1.4), 1.1, GEAR, r2=0.8, squash=0.6)
    m.capsule(X((hx - 14.0, hy - 3.0), 1.4), X((hx - 18.0, hy - 7.0), 1.6), 0.8, GEAR, r2=0.5, squash=0.6)

ARMS = {}
def arm(m, sh, hand, far, sleeve=SHIRT, down=True, glove=True):
    y = YF if far else YN
    el, h = bend(sh, hand, 6.8, 6.4, down); ARMS["far" if far else "near"] = (el, h)
    if not BODY: m.capsule(X(sh, y), X(el, y), 3.4, sleeve, far, r2=3.0)                                       # sleeve
    mid = ((sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2)
    m.cyl(X(((sh[0] + 2 * el[0]) / 3, (sh[1] + 2 * el[1]) / 3), y), X(el, y), 3.4, 3.3, SHIRT_D, far)            # rolled cuff
    if not BODY: m.capsule(X(el, y), X(h, y), 2.8, SKIN, far, r2=2.4)                                          # forearm
    m.sphere(X(h, y), 2.9, BELT if glove else SKIN, far)                                                        # gloved fist
    return el, h

# ---------- weapons (grip at 0,0; x forward, z up; aim rotates them) ----------
def rot(aim, x, z): return (-z, x) if aim == "u" else (z, -x) if aim == "d" else (x, z)
ANG = {"f": 0.0, "u": math.pi / 2, "d": -math.pi / 2}
GUNS = {
    "pistol": dict(one=True, m=(10.0, 2.6), parts=[
        ("box", (-1.2, 0.2, 8.8, 3.6), 2.0, G_DARK), ("box", (0.0, 3.0, 9.0, 4.0), 1.6, G_MID), ("box", (-1.4, -4.6, 2.0, 0.4), 1.8, G_DARK),
        ("box", (8.6, 1.4, 10.0, 3.4), 1.0, G_LIGHT)]),
    "H": dict(m=(23.0, 2.0), parts=[
        ("box", (-8.0, -1.2, -1.0, 3.2), 2.2, G_DARK), ("box", (-1.0, -1.4, 12.5, 4.4), 3.0, G_DARK), ("box", (0.0, 4.0, 11.0, 5.2), 2.2, G_MID),
        ("cyl", (12.5, 2.0, 22.5, 2.0), 1.1, G_LIGHT), ("cyl", (12.5, 2.0, 18.0, 2.0), 1.9, G_MID), ("box", (3.0, -7.0, 7.0, -1.0), 2.0, G_MID),
        ("box", (20.5, 0.6, 23.0, 3.4), 1.6, G_DARK)]),
    "R": dict(m=(19.0, 2.6), parts=[
        ("cyl", (-10.0, 2.6, 17.0, 2.6), 3.2, OLIVE), ("cyl", (15.0, 2.6, 19.0, 2.6), 3.8, OLIVE_D), ("cyl", (-11.0, 2.6, -8.0, 2.6), 3.6, OLIVE_D),
        ("box", (2.0, 5.2, 5.4, 7.6), 1.6, G_DARK), ("box", (0.6, -4.4, 3.0, 0.0), 1.6, G_DARK)]),
    "F": dict(m=(20.0, 2.0), parts=[
        ("box", (-2.0, 0.0, 14.0, 4.2), 2.6, G_DARK), ("cyl", (14.0, 2.0, 19.5, 2.0), 1.2, RED), ("cyl", (0.5, -3.0, 8.5, -3.0), 2.6, ORANGE),
        ("box", (1.0, 4.0, 11.0, 5.2), 2.0, G_MID), ("box", (19.0, 1.0, 20.2, 3.0), 1.4, G_LIGHT)]),
    "S": dict(m=(20.0, 2.0), parts=[
        ("box", (-8.5, -1.4, -1.0, 2.4), 2.0, WOOD), ("box", (-1.0, 0.0, 7.0, 3.4), 2.4, G_DARK), ("cyl", (7.0, 2.4, 20.0, 2.4), 1.1, G_MID),
        ("cyl", (7.0, 0.6, 18.0, 0.6), 0.9, G_DARK), ("box", (9.0, -1.4, 14.5, 0.6), 2.4, PUMP)]),
    "L": dict(m=(18.0, 2.0), parts=[
        ("box", (-3.0, -1.2, 12.0, 4.4), 2.8, G_DARK), ("box", (1.0, 1.0, 10.0, 3.2), 3.0, LASER), ("cyl", (12.0, 2.0, 16.0, 2.0), 1.8, G_LIGHT),
        ("cyl", (16.0, 2.0, 17.6, 2.0), 1.0, LASER_TIP), ("box", (2.0, -5.4, 5.0, -1.0), 1.8, G_MID)]),
}

def gun(m, gid, grip, aim, y=-8.6):
    a = ANG[aim]; gx, gz = grip
    for kind, (x0, z0, x1, z1), dep, pid in GUNS[gid]["parts"]:
        if kind == "box":
            m.box((gx + x0, y - dep / 2, gz + z0), (gx + x1, y + dep / 2, gz + z1), pid, bevel=0.3, about=(gx, gz), ang=a)
        else:
            p0, p1 = rot(aim, x0, z0), rot(aim, x1, z1)
            m.cyl((gx + p0[0], y, gz + p0[1]), (gx + p1[0], y, gz + p1[1]), dep, dep, pid, seg=12)

def grip_for(aim, recoil):
    s, k = SH_N, 2 if recoil else 0
    if aim == "u": return (s[0] + 3, s[1] + 8 - k)
    if aim == "d": return (s[0] + 4, s[1] - 9 + k)
    return (s[0] + 9 - k, s[1] - 1)

def upper(m, kind, gid=None, aim="f", recoil=False, flail=0):
    """kind: gun | knife | throw | flail | idle"""
    meta = {}; ARMS.clear()
    # far arm first (it is behind the body)
    if kind == "gun":
        grip = grip_for(aim, recoil)
        if not GUNS[gid].get("one"):
            f = rot(aim, 8, 0); arm(m, SH_F, (grip[0] + f[0], grip[1] + f[1]), True)
        else: arm(m, SH_F, (SH_F[0] - 1, SH_F[1] - 11), True)
    elif kind == "flail": arm(m, SH_F, (SH_F[0] - 3, SH_F[1] + 11 - flail * 2), True)
    elif kind == "tuck": arm(m, SH_F, (SH_F[0] + 9, SH_F[1] - 7), True)
    else: arm(m, SH_F, (SH_F[0] - 1, SH_F[1] - 11), True)
    torso(m); head(m, panic=kind == "flail")
    s = SH_N
    if kind == "gun":
        grip = grip_for(aim, recoil)
        gun(m, gid, grip, aim)
        arm(m, s, grip, False)
        mm = rot(aim, *GUNS[gid]["m"]); meta["muzzle"] = [grip[0] + mm[0] - HIP[0], grip[1] + mm[1] - HIP[1]]
    elif kind == "knife":
        h = (s[0] + 11, s[1]); arm(m, s, h, False)
        m.box((h[0] + 1.5, -9.4, h[1] - 0.2), (h[0] + 10.0, -8.6, h[1] + 1.4), STEEL, bevel=0.2)
        m.box((h[0] + 0.5, -9.6, h[1] - 1.2), (h[0] + 1.8, -8.4, h[1] + 2.4), G_DARK, bevel=0.2)
    elif kind == "throw":
        h = (s[0] - 6, s[1] + 8); arm(m, s, h, False)
        m.sphere((h[0] - 1.5, YN - 1.5, h[1] + 3.0), 2.6, OLIVE); m.box((h[0] - 2.4, YN - 2.0, h[1] + 5.0), (h[0] - 0.6, YN - 1.0, h[1] + 6.4), G_LIGHT, bevel=0)
    elif kind == "flail": arm(m, s, (s[0] + 3, s[1] + 10 + flail * 2), False)
    elif kind == "tuck": arm(m, s, (s[0] + 8, s[1] - 8), False)
    else: arm(m, s, (s[0] + 1, s[1] - 11), False)
    if BODY: base_body(m, body_targets(HIP, arms=ARMS, upper=True), set(SEGS) - LEG_SEGS)   # torso, shoulders, arms
    return meta

# ---------- scene + render ----------
RES = 112                     # render canvas (hi px); world origin at pixel (56, 100) from the top-left
def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 1; sc.cycles.device = "CPU"
    sc.cycles.pixel_filter_type = "BOX"; sc.cycles.filter_width = 0.01; sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True; sc.render.dither_intensity = 0
    sc.view_settings.view_transform = "Raw"; sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"; sc.render.image_settings.color_depth = "16"
    cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"; cam.ortho_scale = RES
    co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
    co.location = (0, -200, 100 - RES / 2); co.rotation_euler = (math.pi / 2, 0, 0)
    cam.clip_start = 1; cam.clip_end = 400
    # one material: mode 0 = id, 1 = normal, 2 = depth
    mat = bpy.data.materials.new("M"); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear(); N = nt.nodes.new; Lk = nt.links.new
    out = N("ShaderNodeOutputMaterial"); em = N("ShaderNodeEmission")
    a_id = N("ShaderNodeAttribute"); a_id.attribute_name = "pid"; a_id.attribute_type = "GEOMETRY"
    a_far = N("ShaderNodeAttribute"); a_far.attribute_name = "far"
    comb = N("ShaderNodeCombineXYZ"); div = N("ShaderNodeMath"); div.operation = "MULTIPLY"; div.inputs[1].default_value = 1 / 64
    Lk(a_id.outputs["Fac"], div.inputs[0]); Lk(div.outputs[0], comb.inputs[0]); Lk(a_far.outputs["Fac"], comb.inputs[1])
    geo = N("ShaderNodeNewGeometry"); nm = N("ShaderNodeVectorMath"); nm.operation = "MULTIPLY_ADD"
    nm.inputs[1].default_value = (0.5, 0.5, 0.5); nm.inputs[2].default_value = (0.5, 0.5, 0.5); Lk(geo.outputs["Normal"], nm.inputs[0])
    sep = N("ShaderNodeSeparateXYZ"); Lk(geo.outputs["Position"], sep.inputs[0])
    dz = N("ShaderNodeMath"); dz.operation = "MULTIPLY_ADD"; dz.inputs[1].default_value = 1 / 60; dz.inputs[2].default_value = 0.5
    Lk(sep.outputs["Y"], dz.inputs[0])
    dcol = N("ShaderNodeCombineXYZ"); Lk(dz.outputs[0], dcol.inputs[0])
    mode = N("ShaderNodeValue"); mode.name = "mode"
    m1 = N("ShaderNodeMix"); m1.data_type = "VECTOR"; m2 = N("ShaderNodeMix"); m2.data_type = "VECTOR"
    g1 = N("ShaderNodeMath"); g1.operation = "GREATER_THAN"; g1.inputs[1].default_value = 0.5; Lk(mode.outputs[0], g1.inputs[0])
    g2 = N("ShaderNodeMath"); g2.operation = "GREATER_THAN"; g2.inputs[1].default_value = 1.5; Lk(mode.outputs[0], g2.inputs[0])
    Lk(g1.outputs[0], m1.inputs["Factor"]); Lk(comb.outputs[0], m1.inputs[4]); Lk(nm.outputs[0], m1.inputs[5])
    Lk(g2.outputs[0], m2.inputs["Factor"]); Lk(m1.outputs[1], m2.inputs[4]); Lk(dcol.outputs[0], m2.inputs[5])
    Lk(m2.outputs[1], em.inputs["Color"]); Lk(em.outputs[0], out.inputs["Surface"])
    return sc

def render_pass(sc, mode):
    bpy.data.materials["M"].node_tree.nodes["mode"].outputs[0].default_value = mode
    path = f"{TMP}/p{mode}.png"; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path); img.colorspace_settings.name = "Non-Color"
    a = np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)[::-1]
    bpy.data.images.remove(img)
    return a

LIGHT = np.array([-0.42, 0.72, 0.55]); LIGHT /= np.linalg.norm(LIGHT)
def bake(sc):
    """-> (H x W) uint8 codes: 0 empty, else 1 + (id*4 + level)*2 + far"""
    A, Nn, D = render_pass(sc, 0), render_pass(sc, 1), render_pass(sc, 2)
    alpha = A[..., 3] > 0.5
    pid = np.rint(A[..., 0] * 64).astype(int); far = A[..., 1] > 0.5
    n = Nn[..., :3] * 2 - 1
    ns = np.stack([n[..., 0], n[..., 2], -n[..., 1]], -1)            # screen space: x right, y up, z to camera
    d = ns @ LIGHT
    lvl = np.where(d > 0.62, 3, np.where(d > 0.12, 2, np.where(d > -0.38, 1, 0)))
    depth = D[..., 0]
    # interior lines: a pixel noticeably behind its neighbour gets the darkest tone
    edge = np.zeros_like(alpha)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb_d = np.roll(np.roll(depth, dy, 0), dx, 1); nb_a = np.roll(np.roll(alpha, dy, 0), dx, 1)
        nb_id = np.roll(np.roll(pid, dy, 0), dx, 1)
        edge |= alpha & nb_a & ((depth - nb_d) * 60 > 2.2) & (nb_id != pid)
    # despeckle: a lone tone pixel inside a part takes the tone its same-part neighbours agree on
    for _ in range(2):
        votes = np.zeros(lvl.shape + (4,), int)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nl = np.roll(np.roll(lvl, dy, 0), dx, 1); same = np.roll(np.roll(pid, dy, 0), dx, 1) == pid
            for k in range(4): votes[..., k] += same & (nl == k)
        best = votes.argmax(-1); lone = np.take_along_axis(votes, lvl[..., None], -1)[..., 0] == 0
        lvl = np.where(lone & (votes.max(-1) >= 3), best, lvl)
    lvl = np.where(edge, 0, lvl)
    code = np.where(alpha, 1 + (pid * 4 + lvl) * 2 + far.astype(int), 0).astype(np.uint8)
    return code

ROLL_C = (1.0, 0.0)    # x of the ball's spin centre (hi px); it is kept touching the ground
def roll(m, k):
    """Full-body forward roll, frame k of 8: legs tucked, body curled over them, the whole ball turned."""
    sk = skeleton("roll"); legs(m, sk)
    before = set(m.bm.verts)
    upper(m, "tuck")
    vs = [v for v in m.bm.verts if v not in before]
    hip = Vector((sk["hip"][0], 0, sk["hip"][1]))
    bmesh.ops.translate(m.bm, verts=vs, vec=hip - Vector((HIP[0], 0, HIP[1])))
    bmesh.ops.rotate(m.bm, verts=vs, cent=hip, matrix=Matrix.Rotation(1.15, 3, "Y"))       # curl forward over the knees
    allv = list(m.bm.verts)
    lo = Vector((min(v.co.x for v in allv), 0, min(v.co.z for v in allv))); hi = Vector((max(v.co.x for v in allv), 0, max(v.co.z for v in allv)))
    c = (lo + hi) / 2; c.x = ROLL_C[0]
    bmesh.ops.rotate(m.bm, verts=allv, cent=c, matrix=Matrix.Rotation(k / 8 * math.tau, 3, "Y"))
    bmesh.ops.translate(m.bm, verts=allv, vec=Vector((0, 0, -min(v.co.z for v in allv))))   # the ball rolls on the ground

def frame(sc, build, ground=False):
    for ob in list(bpy.data.objects):
        if ob.type == "MESH": bpy.data.objects.remove(ob)
    m = Mesh(); meta = build(m) or {}; m.finish()
    code = bake(sc)
    if ground: code[100:, :] = 0      # nothing sinks below the ground line (kneeling knee, squat)
    ys, xs = np.nonzero(code)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return code[y0:y1, x0:x1], int(56 - x0), int(100 - y0), meta     # crop + origin inside the crop

def rle(b):
    out = bytearray(); i = 0; n = len(b)
    while i < n:
        v = b[i]; j = i
        while j < n and b[j] == v and j - i < 255: j += 1
        out += bytes((v, j - i)); i = j
    return out

def main():
    if "--no-base" not in sys.argv: load_base()
    sc = setup()
    frames = {}
    def add(name, build, origin="feet"):
        c, ox, oy, meta = frame(sc, build, ground=origin == "feet")
        if origin == "hip": ox, oy = ox + int(HIP[0]), oy - int(HIP[1])   # origin = canonical hip
        frames[name] = dict(w=int(c.shape[1]), h=int(c.shape[0]), ox=ox, oy=oy, data=c, **meta)
        print("frame", name, c.shape, flush=True)
    for pose in ("stand", "jump", "fall", "crouch"):
        add("L_" + pose, lambda m, p=pose: legs(m, skeleton(p)))
    for f in range(12):
        add(f"L_run{f}", lambda m, f=f: legs(m, skeleton("run", f)))
    add("L_apex", lambda m: legs(m, skeleton("apex")))
    for f in range(8):
        add(f"L_cwalk{f}", lambda m, f=f: legs(m, skeleton("cwalk", f)))
    for k in range(8):
        add(f"R_roll{k}", lambda m, k=k: roll(m, k))
    for gid in GUNS:
        for aim in ("f", "u", "d"):
            for rc in (False, True):
                add(f"U_{gid}_{aim}{'r' if rc else ''}", lambda m, g=gid, a=aim, r=rc: upper(m, "gun", g, a, r), origin="hip")
    for kind in ("knife", "throw", "idle"):
        add("U_" + kind, lambda m, k=kind: upper(m, k), origin="hip")
    for f in (0, 1):
        add(f"U_flail{f}", lambda m, f=f: upper(m, "flail", flail=f), origin="hip")
    # pack: frame table + one RLE byte stream
    blob = bytearray(); table = {}
    for name, fr in frames.items():
        raw = fr["data"].tobytes(); enc = rle(raw)
        table[name] = [fr["w"], fr["h"], fr["ox"], fr["oy"], len(blob), len(enc)] + ([round(v, 2) for v in fr["muzzle"]] if "muzzle" in fr else [])
        blob += enc
    pal = [[k, h] for k, h in IDS]
    js = ("\"use strict\";\n// Generated by slugger/art/hero.py from the Blender model; do not edit by hand.\n"
          "// Palette-indexed hero frames: byte = 0 empty, else 1 + (part*4 + tone)*2 + far. RLE pairs (value, count).\n"
          f"const HERO_ART = {{ head: \"h_rayo\", hip: [{HIP[0]}, {HIP[1]}], parts: {json.dumps(pal)},\n"
          f"  frames: {json.dumps(table, separators=(',', ':'))},\n"
          f"  rle: \"{base64.b64encode(bytes(blob)).decode()}\" }};\n")
    open(os.path.join(ROOT, "js", "hero_art.js"), "w").write(js)
    print("wrote hero_art.js", len(js), "bytes,", len(frames), "frames")
    if "--preview" in sys.argv: preview(frames, sys.argv[sys.argv.index("--preview") + 1])

# ---------- preview sheet (Rayo's base palette, 4x) for checking the art without the game ----------
BASE = dict(S="#e6b088", s="#a87a5e", H="#4a2e1c", h="#2e1a0e", A="#2e3548", a="#1c2130", C="#4f5a6e", c="#363e4e", D="#6c7892",
            P="#4a5468", p="#343c4c", B="#201e1e", b="#3c3836", K="#2c2824", N="#3e4436", n="#2a2e24")
def hexrgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]
def shade(c, k): return [v * (1 + k) if k < 0 else v + (255 - v) * k for v in c]
def colors(code):
    v = code - 1; far = v % 2; v //= 2; pid = v // 4; lvl = v % 4
    k, h = IDS[pid]; base = hexrgb(h or BASE[k])
    if far: base = shade(base, -0.18)
    return shade(base, [-0.42, -0.2, 0, 0.22][lvl])
def compose(frames, lower, upper_, hipx, hipy):
    W, Hh = 112, 100; img = np.zeros((Hh, W, 4), np.uint8); ox, oy = 50, 92
    def put(fr, x, y):
        d = fr["data"]
        for r in range(d.shape[0]):
            for q in range(d.shape[1]):
                if d[r, q]:
                    yy, xx = y + r, x + q
                    if 0 <= yy < Hh and 0 <= xx < W: img[yy, xx] = colors(int(d[r, q])) + [255]
    L = frames[lower]; put(L, ox - L["ox"], oy - L["oy"])
    if upper_: U = frames[upper_]; put(U, ox + hipx - U["ox"], oy - hipy - U["oy"])
    # outline
    a = img[..., 3] > 0; o = np.zeros_like(a)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): o |= np.roll(np.roll(a, dy, 0), dx, 1)
    img[o & ~a] = [20, 12, 10, 255]
    return img
def preview(frames, out):
    combos = [("L_stand", "U_pistol_f", "stand", 0), ("L_run0", "U_H_f", "run", 0), ("L_run3", "U_H_f", "run", 3), ("L_jump", "U_pistol_f", "jump", 0),
              ("L_apex", "U_S_u", "apex", 0), ("L_fall", "U_L_d", "fall", 0), ("L_crouch", "U_F_f", "crouch", 0), ("L_cwalk0", "U_pistol_f", "cwalk", 0),
              ("L_cwalk2", "U_pistol_f", "cwalk", 2), ("L_cwalk4", "U_pistol_f", "cwalk", 4), ("L_cwalk6", "U_pistol_f", "cwalk", 6), ("L_stand", "U_throw", "stand", 0)]
    combos += [(f"R_roll{k}", None, "stand", 0) for k in range(0, 8, 1)][:6]
    tiles = []
    for lo, up, pose, f in combos:
        sk = skeleton(pose, f)
        tiles.append(compose(frames, lo, up, int(round(sk["hip"][0] + sk["lean"])), int(round(sk["hip"][1]))))
    rows = [np.concatenate(tiles[i:i + 6], 1) for i in range(0, len(tiles), 6)]
    sheet = np.concatenate(rows, 0)
    sheet = np.where(sheet[..., 3:4] > 0, sheet, np.array([120, 160, 190, 255], np.uint8))
    sheet = sheet.repeat(4, 0).repeat(4, 1)
    write_png(out, sheet)
def write_png(path, img):
    h, w = img.shape[:2]
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

if __name__ == "__main__":
    main()
