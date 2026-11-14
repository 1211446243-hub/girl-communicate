#!/usr/bin/env python3
# 心情小表情样稿生成：手写 SVG + 预览图 + 实景示意。不改 src。
from __future__ import annotations
import os
from pathlib import Path
from io import BytesIO

import cairosvg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path("/workspace/girl communicate/design/mood-icons")
SHOTS = Path("/workspace/girl communicate/screenshots")

MOODS = [
    ("calm", "平静"),
    ("happy", "开心"),
    ("excited", "兴奋"),
    ("angry", "生气"),
    ("sulky", "生闷气"),
    ("hurt", "委屈"),
    ("jealous", "吃醋"),
    ("sleepy", "困倦"),
    ("down", "低落"),
]

# 取自 personas/*.json 的 palette，再配皮肤与五官色
GAOLENG = {
    "bg": "#0c1016", "bg2": "#18202b", "glow": "#3d5266",
    "accent": "#a7bccf", "text": "#dfe6ec",
    "stroke": "#3a4e60", "ink": "#2a3b4b", "inksoft": "#3d5266",
    "shine": "#eef3f7",
    "faces": {
        "calm": "#c8d5e0", "happy": "#d0dbe6", "excited": "#d4dee8",
        "angry": "#c4c8d0", "sulky": "#c5ced8", "hurt": "#c3ced8",
        "jealous": "#c8d0d8", "sleepy": "#b8c4d0", "down": "#b0bbc6",
    },
}
KEAI = {
    "bg": "#140e12", "bg2": "#2a1b23", "glow": "#6e3e55",
    "accent": "#efb2c6", "text": "#f3e3e9",
    "stroke": "#7a4558", "ink": "#5a3344", "inksoft": "#8a5468",
    "shine": "#fff8fb",
    "blush": "#e889a4",
    "faces": {
        "calm": "#f4d6e0", "happy": "#f7dce6", "excited": "#f8dfe8",
        "angry": "#efc5d0", "sulky": "#f0cdd8", "hurt": "#f0d0db",
        "jealous": "#f3c9d6", "sleepy": "#e6c8d2", "down": "#d9b8c4",
    },
}

def svg_doc(inner: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"'
        ' width="32" height="32" fill="none">\n'
        f'{inner.rstrip()}\n'
        '</svg>\n'
    )

def g_face_base(p, mood, extra_fill=""):
    face = p["faces"][mood]
    glow, stroke, shine = p["glow"], p["stroke"], p["shine"]
    # 底部一点体积，顶部一点冷光
    return f'''  <circle cx="16" cy="16.7" r="14.1" fill="{glow}" opacity="0.26"/>
  <circle cx="16" cy="16" r="12.55" fill="{face}"/>
  {extra_fill}
  <ellipse cx="12.3" cy="11.1" rx="4.0" ry="2.5" fill="{shine}" opacity="0.30"/>
  <circle cx="16" cy="16" r="12.55" fill="none" stroke="{stroke}" stroke-width="1.1"/>'''

def g_puff_base(p, mood):
    face, glow, stroke, shine = p["faces"][mood], p["glow"], p["stroke"], p["shine"]
    # 鼓脸：头顶仍圆，两颊外扩
    puff = (
        "M16 3.35 C22.7 3.35 27.7 8.15 27.95 14.35 "
        "C29.85 16.55 30.05 21.25 27.35 24.05 "
        "C24.85 28.85 19.35 29.65 16 29.65 "
        "C12.65 29.65 7.15 28.85 4.65 24.05 "
        "C1.95 21.25 2.15 16.55 4.05 14.35 "
        "C4.3 8.15 9.3 3.35 16 3.35 Z"
    )
    glowp = (
        "M16 2.15 C23.5 2.15 29.15 7.5 29.4 14.3 "
        "C31.6 16.7 31.85 22.05 28.7 25.2 "
        "C25.85 30.45 19.7 31.25 16 31.25 "
        "C12.3 31.25 6.15 30.45 3.3 25.2 "
        "C0.15 22.05 0.4 16.7 2.6 14.3 "
        "C2.85 7.5 8.5 2.15 16 2.15 Z"
    )
    return f'''  <path d="{glowp}" fill="{glow}" opacity="0.26"/>
  <path d="{puff}" fill="{face}"/>
  <ellipse cx="12.2" cy="11.0" rx="3.8" ry="2.3" fill="{shine}" opacity="0.28"/>
  <path d="{puff}" fill="none" stroke="{stroke}" stroke-width="1.1"/>'''

def k_face_base(p, mood, blush=0.45, extra=""):
    face, glow, stroke, shine = p["faces"][mood], p["glow"], p["stroke"], p["shine"]
    bl = p["blush"]
    b = ""
    if blush > 0:
        b = (
            f'  <ellipse cx="9.2" cy="19.4" rx="2.7" ry="1.85" fill="{bl}" opacity="{blush:.2f}"/>\n'
            f'  <ellipse cx="22.8" cy="19.4" rx="2.7" ry="1.85" fill="{bl}" opacity="{blush:.2f}"/>'
        )
    return f'''  <circle cx="16" cy="16.7" r="14.15" fill="{glow}" opacity="0.30"/>
  <circle cx="16" cy="16" r="12.7" fill="{face}"/>
  <ellipse cx="12.0" cy="10.8" rx="5.0" ry="3.3" fill="{shine}" opacity="0.48"/>
  <circle cx="10.6" cy="10.1" r="1.15" fill="{shine}" opacity="0.80"/>
{b}
  {extra}
  <circle cx="16" cy="16" r="12.7" fill="none" stroke="{stroke}" stroke-width="1.2"/>'''

def k_puff_base(p, mood, blush=0.62):
    face, glow, stroke, shine, bl = p["faces"][mood], p["glow"], p["stroke"], p["shine"], p["blush"]
    puff = (
        "M16 3.2 C22.85 3.2 27.85 8.05 28.1 14.3 "
        "C30.15 16.55 30.35 21.4 27.5 24.25 "
        "C24.95 29.1 19.4 29.8 16 29.8 "
        "C12.6 29.8 7.05 29.1 4.5 24.25 "
        "C1.65 21.4 1.85 16.55 3.9 14.3 "
        "C4.15 8.05 9.15 3.2 16 3.2 Z"
    )
    glowp = (
        "M16 2.0 C23.6 2.0 29.3 7.4 29.55 14.25 "
        "C31.9 16.75 32.15 22.2 28.85 25.4 "
        "C25.95 30.7 19.75 31.4 16 31.4 "
        "C12.25 31.4 6.05 30.7 3.15 25.4 "
        "C-0.15 22.2 0.1 16.75 2.45 14.25 "
        "C2.7 7.4 8.4 2.0 16 2.0 Z"
    )
    return f'''  <path d="{glowp}" fill="{glow}" opacity="0.30"/>
  <path d="{puff}" fill="{face}"/>
  <ellipse cx="12.0" cy="10.7" rx="4.8" ry="3.1" fill="{shine}" opacity="0.45"/>
  <circle cx="10.5" cy="10.0" r="1.1" fill="{shine}" opacity="0.78"/>
  <ellipse cx="8.3" cy="20.3" rx="3.15" ry="2.15" fill="{bl}" opacity="{blush:.2f}"/>
  <ellipse cx="23.7" cy="20.3" rx="3.15" ry="2.15" fill="{bl}" opacity="{blush:.2f}"/>
  <path d="{puff}" fill="none" stroke="{stroke}" stroke-width="1.2"/>'''

# ---------- 沈清：简约冷淡线描 ----------
def gaoleng_icon(mood: str) -> str:
    p = GAOLENG
    ink, acc, shine = p["ink"], p["accent"], p["shine"]
    sl = 'stroke-linecap="round" stroke-linejoin="round"'
    if mood == "calm":
        return f'''{g_face_base(p, mood)}
  <path d="M8.7 14.7h4.8" stroke="{ink}" stroke-width="1.45" {sl}/>
  <path d="M18.5 14.7h4.8" stroke="{ink}" stroke-width="1.45" {sl}/>
  <path d="M14.3 20.35h3.4" stroke="{ink}" stroke-width="1.35" {sl}/>'''
    if mood == "happy":
        return f'''{g_face_base(p, mood)}
  <path d="M8.6 15.35q2.35-2.55 4.7 0" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M18.7 15.35q2.35-2.55 4.7 0" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M13.3 19.7q2.7 2.55 5.4 0" stroke="{ink}" stroke-width="1.4" {sl}/>'''
    if mood == "excited":
        return f'''{g_face_base(p, mood)}
  <ellipse cx="11.05" cy="14.2" rx="2.35" ry="2.55" fill="{ink}"/>
  <ellipse cx="20.95" cy="14.2" rx="2.35" ry="2.55" fill="{ink}"/>
  <circle cx="11.55" cy="13.55" r="0.52" fill="{shine}"/>
  <circle cx="21.45" cy="13.55" r="0.52" fill="{shine}"/>
  <ellipse cx="16" cy="21.2" rx="2.25" ry="1.95" fill="{ink}"/>
  <path d="M25.15 7.2v2.55M23.85 8.45h2.6" stroke="{acc}" stroke-width="1.25" {sl}/>'''
    if mood == "angry":
        return f'''{g_face_base(p, mood)}
  <path d="M8.15 11.35 13.4 13.45" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M23.85 11.35 18.6 13.45" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M8.7 15.55 13.5 16.15" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M23.3 15.55 18.5 16.15" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M13.7 21.35h4.6" stroke="{ink}" stroke-width="1.4" {sl}/>'''
    if mood == "sulky":
        cheek = f'  <ellipse cx="8.0" cy="20.2" rx="2.3" ry="1.7" fill="#c4b4bc" opacity="0.45"/>\n  <ellipse cx="24.0" cy="20.2" rx="2.3" ry="1.7" fill="#c4b4bc" opacity="0.45"/>'
        return f'''{g_puff_base(p, mood)}
{cheek}
  <path d="M8.6 12.55h5.0" stroke="{ink}" stroke-width="1.25" {sl}/>
  <path d="M18.4 12.55h5.0" stroke="{ink}" stroke-width="1.25" {sl}/>
  <path d="M8.9 14.85h4.5" stroke="{ink}" stroke-width="1.4" {sl}/>
  <circle cx="13.15" cy="14.85" r="0.95" fill="{ink}"/>
  <path d="M18.6 14.85h4.5" stroke="{ink}" stroke-width="1.4" {sl}/>
  <circle cx="22.85" cy="14.85" r="0.95" fill="{ink}"/>
  <path d="M16.7 20.0c0.15 1.7 2.05 1.7 2.2 0" stroke="{ink}" stroke-width="1.35" {sl}/>'''
    if mood == "hurt":
        tear = (
            f'  <path d="M6.55 17.55c0 2.05 2.35 2.05 2.35 0 0-1.45-1.17-2.75-1.17-2.75S6.55 16.1 6.55 17.55z"'
            f' fill="{acc}" stroke="{ink}" stroke-width="0.7"/>'
        )
        return f'''{g_face_base(p, mood)}
  <path d="M8.2 13.35q2.85-2.25 5.3 0.05" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M23.8 13.35q-2.85-2.25-5.3 0.05" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M8.7 15.7q2.35 1.05 4.7 0" stroke="{ink}" stroke-width="1.45" {sl}/>
  <path d="M18.6 15.7q2.35 1.05 4.7 0" stroke="{ink}" stroke-width="1.45" {sl}/>
{tear}
  <path d="M12.7 21.2q1.55 1.85 3.3 0q1.75 1.85 3.3 0" stroke="{ink}" stroke-width="1.45" {sl}/>'''
    if mood == "jealous":
        blush = (
            f'  <ellipse cx="9.4" cy="19.6" rx="2.3" ry="1.45" fill="#c4a8b0" opacity="0.40"/>\n'
            f'  <ellipse cx="22.6" cy="19.6" rx="2.3" ry="1.45" fill="#c4a8b0" opacity="0.40"/>'
        )
        return f'''{g_face_base(p, mood)}
{blush}
  <path d="M8.2 11.15 13.35 13.15" stroke="{ink}" stroke-width="1.45" {sl}/>
  <path d="M18.55 12.55h5.1" stroke="{ink}" stroke-width="1.35" {sl}/>
  <path d="M8.6 14.85h4.7" stroke="{ink}" stroke-width="1.45" {sl}/>
  <circle cx="13.1" cy="14.85" r="1.05" fill="{ink}"/>
  <path d="M18.6 14.85h4.7" stroke="{ink}" stroke-width="1.45" {sl}/>
  <circle cx="23.1" cy="14.85" r="1.05" fill="{ink}"/>
  <path d="M14.55 20.15c0.2 1.85 2.7 1.85 2.9 0" stroke="{ink}" stroke-width="1.5" {sl}/>'''
    if mood == "sleepy":
        return f'''{g_face_base(p, mood)}
  <path d="M8.55 14.35q2.4 2.0 4.8 0" stroke="{ink}" stroke-width="1.45" {sl}/>
  <path d="M18.65 14.35q2.4 2.0 4.8 0" stroke="{ink}" stroke-width="1.45" {sl}/>
  <ellipse cx="16" cy="20.85" rx="3.15" ry="3.85" fill="{ink}"/>
  <ellipse cx="16" cy="19.85" rx="1.7" ry="1.55" fill="#1c2732" opacity="0.55"/>'''
    if mood == "down":
        return f'''{g_face_base(p, mood)}
  <path d="M8.55 13.35h4.7" stroke="{ink}" stroke-width="1.25" {sl}/>
  <path d="M18.75 13.35h4.7" stroke="{ink}" stroke-width="1.25" {sl}/>
  <path d="M8.7 16.15q2.35 1.35 4.7 0" stroke="{ink}" stroke-width="1.4" {sl}/>
  <path d="M18.6 16.15q2.35 1.35 4.7 0" stroke="{ink}" stroke-width="1.4" {sl}/>
  <path d="M14.35 22.15h3.3" stroke="{ink}" stroke-width="1.3" {sl}/>'''
    raise KeyError(mood)

# ---------- 林小满：圆润、腮红、高光 ----------
def keai_icon(mood: str) -> str:
    p = KEAI
    ink, acc, shine, bl = p["ink"], p["accent"], p["shine"], p["blush"]
    sl = 'stroke-linecap="round" stroke-linejoin="round"'
    def eye_dots(y=14.15, r=2.35, hx=0.7):
        return f'''  <ellipse cx="11.0" cy="{y}" rx="{r}" ry="{r+0.05}" fill="{ink}"/>
  <ellipse cx="21.0" cy="{y}" rx="{r}" ry="{r+0.05}" fill="{ink}"/>
  <circle cx="{11.0+hx+0.15}" cy="{y-0.7}" r="0.85" fill="{shine}"/>
  <circle cx="{21.0+hx+0.15}" cy="{y-0.7}" r="0.85" fill="{shine}"/>'''
    if mood == "calm":
        return f'''{k_face_base(p, mood, blush=0.38)}
{eye_dots(14.2, 2.25)}
  <path d="M13.5 20.0q2.5 1.85 5.0 0" stroke="{ink}" stroke-width="1.45" {sl}/>'''
    if mood == "happy":
        return f'''{k_face_base(p, mood, blush=0.62)}
  <path d="M8.15 15.45q2.85-3.15 5.7 0" stroke="{ink}" stroke-width="1.7" {sl}/>
  <path d="M18.15 15.45q2.85-3.15 5.7 0" stroke="{ink}" stroke-width="1.7" {sl}/>
  <path d="M12.4 19.55q3.6 3.35 7.2 0" stroke="{ink}" stroke-width="1.6" {sl}/>'''
    if mood == "excited":
        star = (
            f'  <path d="M25.55 6.7l0.55 1.35 1.4.55-1.4.55-.55 1.35-.55-1.35-1.4-.55 1.4-.55z" fill="{acc}"/>'
        )
        return f'''{k_face_base(p, mood, blush=0.58)}
  <ellipse cx="11.0" cy="13.95" rx="2.55" ry="2.75" fill="{ink}"/>
  <ellipse cx="21.0" cy="13.95" rx="2.55" ry="2.75" fill="{ink}"/>
  <circle cx="11.85" cy="13.05" r="0.95" fill="{shine}"/>
  <circle cx="21.85" cy="13.05" r="0.95" fill="{shine}"/>
  <path d="M11 13.95l0.45 1.05 1.1.4-1.1.4-.45 1.05-.45-1.05-1.1-.4 1.1-.4z" fill="{shine}" opacity="0.9"/>
  <path d="M21 13.95l0.45 1.05 1.1.4-1.1.4-.45 1.05-.45-1.05-1.1-.4 1.1-.4z" fill="{shine}" opacity="0.9"/>
  <ellipse cx="16" cy="21.35" rx="3.05" ry="2.55" fill="{ink}"/>
  <ellipse cx="16" cy="20.55" rx="1.55" ry="1.15" fill="#4a2a36" opacity="0.45"/>
{star}'''
    if mood == "angry":
        return f'''{k_face_base(p, mood, blush=0.55)}
  <path d="M7.7 11.15 13.55 13.5" stroke="{ink}" stroke-width="1.65" {sl}/>
  <path d="M24.3 11.15 18.45 13.5" stroke="{ink}" stroke-width="1.65" {sl}/>
  <ellipse cx="11.05" cy="15.35" rx="2.3" ry="2.05" fill="{ink}"/>
  <ellipse cx="20.95" cy="15.35" rx="2.3" ry="2.05" fill="{ink}"/>
  <circle cx="11.55" cy="14.75" r="0.7" fill="{shine}"/>
  <circle cx="21.45" cy="14.75" r="0.7" fill="{shine}"/>
  <path d="M13.1 21.7q2.9-1.7 5.8 0" stroke="{ink}" stroke-width="1.55" {sl}/>'''
    if mood == "sulky":
        return f'''{k_puff_base(p, mood, blush=0.72)}
  <path d="M8.3 12.2h5.1" stroke="{ink}" stroke-width="1.4" {sl}/>
  <path d="M18.6 12.2h5.1" stroke="{ink}" stroke-width="1.4" {sl}/>
  <ellipse cx="11.3" cy="14.85" rx="2.15" ry="2.05" fill="{ink}"/>
  <ellipse cx="21.4" cy="14.85" rx="2.15" ry="2.05" fill="{ink}"/>
  <circle cx="12.55" cy="14.55" r="0.85" fill="{shine}"/>
  <circle cx="22.65" cy="14.55" r="0.85" fill="{shine}"/>
  <path d="M16.5 20.15c0.2 1.9 2.35 1.9 2.55 0" stroke="{ink}" stroke-width="1.5" {sl}/>'''
    if mood == "hurt":
        tear = (
            f'  <path d="M7.05 17.45c0 1.85 2.05 1.85 2.05 0 0-1.25-1.02-2.55-1.02-2.55s-1.03 1.3-1.03 2.55z"'
            f' fill="#f0f6fb" stroke="{ink}" stroke-width="0.55"/>'
        )
        return f'''{k_face_base(p, mood, blush=0.50)}
  <path d="M8.0 12.7q3.05-2.15 5.7 0.35" stroke="{ink}" stroke-width="1.5" {sl}/>
  <path d="M24.0 12.7q-3.05-2.15-5.7 0.35" stroke="{ink}" stroke-width="1.5" {sl}/>
  <ellipse cx="11.0" cy="15.15" rx="2.35" ry="2.2" fill="{ink}"/>
  <ellipse cx="21.0" cy="15.15" rx="2.35" ry="2.2" fill="{ink}"/>
  <circle cx="11.7" cy="14.4" r="0.85" fill="{shine}"/>
  <circle cx="21.7" cy="14.4" r="0.85" fill="{shine}"/>
{tear}
  <path d="M12.7 21.3q1.6 1.85 3.3 0q1.7 1.85 3.3 0" stroke="{ink}" stroke-width="1.5" {sl}/>'''
    if mood == "jealous":
        heart = f'  <path d="M26.35 8.35c0-1.05-.85-1.75-1.75-1.75-.6 0-1.15.3-1.45.85-.3-.55-.85-.85-1.45-.85-.9 0-1.75.7-1.75 1.75 0 2.05 3.2 3.85 3.2 3.85s3.2-1.8 3.2-3.85z" fill="{acc}"/>'
        return f'''{k_face_base(p, mood, blush=0.72)}
{heart}
  <path d="M8.1 11.55 12.9 13.0" stroke="{ink}" stroke-width="1.45" {sl}/>
  <path d="M18.5 12.35h5.2" stroke="{ink}" stroke-width="1.4" {sl}/>
  <ellipse cx="11.15" cy="14.85" rx="2.2" ry="2.1" fill="{ink}"/>
  <ellipse cx="21.2" cy="14.85" rx="2.2" ry="2.1" fill="{ink}"/>
  <circle cx="12.4" cy="14.55" r="0.85" fill="{shine}"/>
  <circle cx="22.45" cy="14.55" r="0.85" fill="{shine}"/>
  <path d="M14.7 20.55h2.6" stroke="{ink}" stroke-width="1.7" {sl}/>'''
    if mood == "sleepy":
        return f'''{k_face_base(p, mood, blush=0.32)}
  <path d="M8.05 14.15q2.9 2.55 5.8 0" stroke="{ink}" stroke-width="1.65" {sl}/>
  <path d="M18.15 14.15q2.9 2.55 5.8 0" stroke="{ink}" stroke-width="1.65" {sl}/>
  <ellipse cx="16" cy="21.0" rx="3.55" ry="4.15" fill="{ink}"/>
  <ellipse cx="16" cy="20.0" rx="1.9" ry="1.7" fill="#4a2a36" opacity="0.5"/>'''
    if mood == "down":
        return f'''{k_face_base(p, mood, blush=0.18)}
  <path d="M8.3 13.15h5.2" stroke="{ink}" stroke-width="1.35" {sl}/>
  <path d="M18.5 13.15h5.2" stroke="{ink}" stroke-width="1.35" {sl}/>
  <ellipse cx="11.05" cy="16.35" rx="2.2" ry="1.7" fill="{ink}"/>
  <ellipse cx="20.95" cy="16.35" rx="2.2" ry="1.7" fill="{ink}"/>
  <circle cx="11.35" cy="16.85" r="0.55" fill="{shine}" opacity="0.45"/>
  <circle cx="21.25" cy="16.85" r="0.55" fill="{shine}" opacity="0.45"/>
  <path d="M13.9 22.35q2.1-0.9 4.2 0" stroke="{ink}" stroke-width="1.45" {sl}/>'''
    raise KeyError(mood)

def write_svgs():
    out = {}
    for folder, fn in (("gaoleng", gaoleng_icon), ("keai", keai_icon)):
        d = ROOT / folder
        d.mkdir(parents=True, exist_ok=True)
        for mid, label in MOODS:
            body = fn(mid)
            # 仅作无障碍标题，画面上不出现文字
            marked = f'  <title>{label}</title>\n' + body
            text = svg_doc(marked)
            path = d / f"{mid}.svg"
            path.write_text(text, encoding="utf-8")
            out[(folder, mid)] = path
    return out

def render_svg(path: Path, px: int) -> Image.Image:
    data = cairosvg.svg2png(url=str(path), output_width=px, output_height=px)
    return Image.open(BytesIO(data)).convert("RGBA")

def load_font(kind: str, size: int):
    if kind == "serif":
        return ImageFont.truetype(
            "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", size, index=2
        )
    if kind == "serif-b":
        return ImageFont.truetype(
            "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", size, index=2
        )
    if kind == "sans-b":
        return ImageFont.truetype(
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", size, index=2
        )
    return ImageFont.truetype(
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", size, index=2
    )

def text_size(font, text):
    b = font.getbbox(text)
    return b[2] - b[0], b[3] - b[1]

def make_preview(svg_paths):
    W, H = 2200, 1140
    img = Image.new("RGB", (W, H), "#0a0e14")
    draw = ImageDraw.Draw(img)
    # 夜色渐变
    for y in range(H):
        t = y / (H - 1)
        # 上沿略冷蓝，下沿更深
        r = int(10 + (14 - 10) * t)
        g = int(14 + (10 - 14) * t)
        b = int(20 + (16 - 20) * t)
        draw.line((0, y, W, y), fill=(r, g, b))
    # 很淡的光晕
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((400, -180, 1800, 420), fill=(61, 82, 102, 38))
    gd.ellipse((200, 980, 900, 1500), fill=(61, 82, 102, 18))
    gd.ellipse((1400, 900, 2300, 1500), fill=(110, 62, 85, 22))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(60))).convert("RGB")
    draw = ImageDraw.Draw(img)

    title_f = load_font("serif", 46)
    sub_f = load_font("sans", 20)
    row_f = load_font("serif", 28)
    type_f = load_font("sans", 16)
    cap_f = load_font("sans", 18)
    small_f = load_font("sans", 16)
    foot_f = load_font("sans", 15)

    title = "心情小表情  ·  样稿"
    tw, _ = text_size(title_f, title)
    draw.text(((W - tw) / 2, 48), title, font=title_f, fill="#dfe6ec")
    sub = "尚未接入软件，仅供预览    表情只透出情绪，不写文字标签"
    sw, _ = text_size(sub_f, sub)
    draw.text(((W - sw) / 2, 110), sub, font=sub_f, fill="#8a9aab")

    # 布局：左边人设名，九列大图
    left = 210
    col_w = 210
    icon_big = 128
    rows = [
        ("gaoleng", "沈清", "高冷", GAOLENG, 190),
        ("keai", "林小满", "可爱", KEAI, 430),
    ]
    for pid, name, typ, pal, y0 in rows:
        # 行左侧标签
        draw.text((56, y0 + 40), name, font=row_f, fill=pal["text"])
        tw2, _ = text_size(type_f, typ)
        draw.text((56, y0 + 82), typ, font=type_f, fill=pal["accent"])
        # 人设色浅条
        draw.rounded_rectangle((46, y0 + 28, 52, y0 + 150), 3, fill=pal["accent"])
        # 浅色底托
        tray = pal["bg2"]
        for i, (mid, label) in enumerate(MOODS):
            cx = left + i * col_w + col_w // 2
            cy = y0 + 78
            # 底托圆
            r = 78
            mat = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            md = ImageDraw.Draw(mat)
            # parse bg2
            hexcol = pal["bg2"].lstrip("#")
            rgb = tuple(int(hexcol[k:k+2], 16) for k in (0, 2, 4)) + (160,)
            md.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgb)
            img = Image.alpha_composite(img.convert("RGBA"), mat.filter(ImageFilter.GaussianBlur(0))).convert("RGB")
            # icon
            icon = render_svg(svg_paths[(pid, mid)], icon_big)
            ix, iy = int(cx - icon_big / 2), int(cy - icon_big / 2)
            img.paste(icon, (ix, iy), icon)
            draw = ImageDraw.Draw(img)
            lw, _ = text_size(cap_f, label)
            draw.text((cx - lw / 2, y0 + 164), label, font=cap_f, fill=pal["accent"])

    # 分割线
    draw = ImageDraw.Draw(img)
    draw.line((80, 690, W - 80, 690), fill="#243040")
    sec = "28 px 小尺寸效果"
    sw, _ = text_size(small_f, sec)
    draw.text(((W - sw) / 2, 708), sec, font=small_f, fill="#8a9aab")

    # 小尺寸两行，带背景小托，也写图注以免对不上
    small = 28
    gap = 86
    start_x = (W - (9 * gap - (gap - small))) // 2
    small_rows = [
        ("gaoleng", "沈清", GAOLENG, 760),
        ("keai", "林小满", KEAI, 900),
    ]
    name_f = load_font("serif", 20)
    tiny_f = load_font("sans", 14)
    for pid, name, pal, y0 in small_rows:
        draw.text((56, y0 + 8), name, font=name_f, fill=pal["text"])
        # also a 32px companion? just 28 as requested; add a second strip of 32 slightly below? keep one size clean.
        for i, (mid, label) in enumerate(MOODS):
            cx = start_x + i * gap + small // 2
            # dark chip behind
            chip = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            cd = ImageDraw.Draw(chip)
            hexcol = pal["bg2"].lstrip("#")
            rgb = tuple(int(hexcol[k:k+2], 16) for k in (0, 2, 4)) + (200,)
            cd.rounded_rectangle((cx - 30, y0 - 18, cx + 30, y0 + 58), 16, fill=rgb)
            img = Image.alpha_composite(img.convert("RGBA"), chip).convert("RGB")
            icon = render_svg(svg_paths[(pid, mid)], small)
            img.paste(icon, (int(cx - small / 2), y0), icon)
            draw = ImageDraw.Draw(img)
            lw, _ = text_size(tiny_f, label)
            draw.text((cx - lw / 2, y0 + 36), label, font=tiny_f, fill=pal["accent"])

    foot = "「之间」设计样稿    颜色取自各人设 palette    作者 刘博宇SolarSystem"
    fw, _ = text_size(foot_f, foot)
    draw = ImageDraw.Draw(img)
    draw.text(((W - fw) / 2, H - 44), foot, font=foot_f, fill="#5b6b7a")

    dest = ROOT / "preview.png"
    img.save(dest, "PNG")
    print("wrote", dest, img.size)
    return dest

def paste_badge(base: Image.Image, badge: Image.Image, avatar_box, size=22, ring=2):
    """把表情贴到头像右下角，带一圈背景色描边，像状态角标。"""
    l, t, r, b = avatar_box
    bx = int(r - size * 0.62)
    by = int(b - size * 0.62)
    badge = badge.resize((size, size), Image.Resampling.LANCZOS)
    # 取角标中心附近的底色做描边
    raw = base.getpixel((min(base.width - 1, max(0, bx)), min(base.height - 1, max(0, by + size // 2))))
    rgb = tuple(raw[:3]) + (255,)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    pad = ring + 1
    ld.ellipse((bx - pad, by - pad, bx + size + pad, by + size + pad), fill=rgb)
    base = Image.alpha_composite(base.convert("RGBA"), layer)
    base.paste(badge, (bx, by), badge)
    return base

def zoom_avatar(shot: Image.Image, avatar_box, badge: Image.Image, size=24, ring=2, out=196):
    """只把头像和角标提出来放大，不带上旁边被切开的名字。"""
    l, t, r, b = avatar_box
    aw, ah = r - l, b - t
    raw = shot.getpixel((max(0, l - 12), t + ah // 2))
    bg = tuple(raw[:3]) + (255,)
    side = 90
    work = Image.new("RGBA", (side, side), bg)
    ax, ay = 12, 10
    # 略大于头像，带一点本身的柔光，但不伸到名字
    glow = 6
    region = shot.crop((l - glow, t - glow, r + glow, b + glow)).convert("RGBA")
    rw, rh = region.size
    gmask = Image.new("L", (rw, rh), 0)
    ImageDraw.Draw(gmask).ellipse((0, 0, rw - 1, rh - 1), fill=255)
    work.paste(region, (ax - glow, ay - glow), gmask)
    bx = ax + aw - int(size * 0.62)
    by = ay + ah - int(size * 0.62)
    bimg = badge.resize((size, size), Image.Resampling.LANCZOS)
    rd = ImageDraw.Draw(work)
    pad = ring + 1
    rd.ellipse((bx - pad, by - pad, bx + size + pad, by + size + pad), fill=bg)
    work.paste(bimg, (bx, by), bimg)
    # 以头像+角标为中心裁成正方形再放大
    cx = ax + aw * 0.62
    cy = ay + ah * 0.62
    half = 38
    box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    crop = work.crop(box).resize((out, out), Image.Resampling.LANCZOS)
    mask = Image.new("L", (out, out), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, out - 2, out - 2), fill=255)
    circle = Image.new("RGBA", (out, out), (0, 0, 0, 0))
    circle.paste(crop, (0, 0))
    circle.putalpha(mask)
    ringl = Image.new("RGBA", (out, out), (0, 0, 0, 0))
    ImageDraw.Draw(ringl).ellipse((1, 1, out - 2, out - 2), outline=(223, 230, 236, 55), width=2)
    return Image.alpha_composite(circle, ringl)

def make_in_app_mock(svg_paths):
    # 头像精确位置（两张截图布局相同）：左 180，上 98，48×48
    avatar = (180, 98, 228, 146)
    g = Image.open(SHOTS / "12-追问原因-高冷-v1.3.png").convert("RGBA")
    k = Image.open(SHOTS / "10-兴奋-可爱-v1.2.png").convert("RGBA")
    g_badge = render_svg(svg_paths[("gaoleng", "sulky")], 128)
    k_badge = render_svg(svg_paths[("keai", "excited")], 128)
    g = paste_badge(g, g_badge, avatar, size=24, ring=2)
    k = paste_badge(k, k_badge, avatar, size=24, ring=2)

    # 裁到标题栏+对话上半，并在空白处放头像放大
    crop_box = (0, 0, 1180, 500)
    g_c = g.crop(crop_box)
    k_c = k.crop(crop_box)
    # 放大区域要包含角标：角标大约在 (212, 129)-(236, 153)
    g_z = zoom_avatar(g, avatar, g_badge, size=24, out=196)
    k_z = zoom_avatar(k, avatar, k_badge, size=24, out=196)

    pad, gap, cap_h, top, zoom_gap = 36, 28, 56, 104, 28
    col_w = g_c.width
    W = pad * 2 + gap + col_w * 2
    H = top + g_c.height + zoom_gap + 196 + cap_h + pad
    canvas = Image.new("RGB", (W, H), "#0a0e14")
    draw = ImageDraw.Draw(canvas)
    for y in range(H):
        tval = y / max(H - 1, 1)
        draw.line((0, y, W, y), fill=(int(10 + 4 * tval), int(14 - 3 * tval), int(20 - 4 * tval)))

    title_f = load_font("serif", 36)
    sub_f = load_font("sans", 18)
    cap_f = load_font("sans", 18)
    title = "实景示意  ·  头像角上的心情小表情"
    tw, _ = text_size(title_f, title)
    draw.text(((W - tw) / 2, 22), title, font=title_f, fill="#dfe6ec")
    sub = "尚未接入软件，仅把样稿叠在现有聊天页上预览    不含真实 Key"
    sw, _ = text_size(sub_f, sub)
    draw.text(((W - sw) / 2, 66), sub, font=sub_f, fill="#8a9aab")

    x1, y1 = pad, top
    x2 = pad + col_w + gap
    canvas.paste(g_c.convert("RGB"), (x1, y1))
    canvas.paste(k_c.convert("RGB"), (x2, y1))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x1 - 1, y1 - 1, x1 + col_w, y1 + g_c.height), 8, outline="#2a3542")
    draw.rounded_rectangle((x2 - 1, y1 - 1, x2 + col_w, y1 + k_c.height), 8, outline="#3a2430")

    zy = y1 + g_c.height + zoom_gap
    # 放大图居中于各列
    gx = x1 + (col_w - 196) // 2
    kx = x2 + (col_w - 196) // 2
    canvas.paste(g_z, (gx, zy), g_z)
    canvas.paste(k_z, (kx, zy), k_z)

    c1, c2 = "沈清  ·  生闷气（下为头像角放大）", "林小满  ·  兴奋（下为头像角放大）"
    w1, _ = text_size(cap_f, c1)
    w2, _ = text_size(cap_f, c2)
    draw.text((x1 + (col_w - w1) / 2, zy + 196 + 12), c1, font=cap_f, fill="#a7bccf")
    draw.text((x2 + (col_w - w2) / 2, zy + 196 + 12), c2, font=cap_f, fill="#efb2c6")

    dest = ROOT / "in-app-mock.png"
    canvas.save(dest, "PNG")
    print("wrote", dest, canvas.size)
    # close-ups for self-check
    g_z.save("/tmp/badge-gaoleng-close.png")
    k_z.save("/tmp/badge-keai-close.png")
    return dest

def main():
    paths = write_svgs()
    make_preview(paths)
    make_in_app_mock(paths)

if __name__ == "__main__":
    main()
