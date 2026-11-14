#!/usr/bin/env python3
# 生成七个人设 × 九种情绪的静态/动画 SVG，并复制到 assets/mood-icons。
from __future__ import annotations
from pathlib import Path
import shutil

ROOT = Path("/workspace/girl communicate/design/mood-icons")
ASSETS = Path("/workspace/girl communicate/assets/mood-icons")

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

# 颜色与动作幅度。motion: 1 为小满基准；period: 时长倍率（再夹到 1.5–4s）
PERSONAS = {
    "gaoleng": {
        "name": "沈清", "type": "高冷", "kind": "line",
        "motion": 0.55, "period": 1.12,
        "glow": "#3d5266", "accent": "#a7bccf", "stroke": "#3a4e60",
        "ink": "#2a3b4b", "shine": "#eef3f7", "blush": "#c4b4bc",
        "faces": {
            "calm": "#c8d5e0", "happy": "#d0dbe6", "excited": "#d4dee8",
            "angry": "#c4c8d0", "sulky": "#c5ced8", "hurt": "#c3ced8",
            "jealous": "#c8d0d8", "sleepy": "#b8c4d0", "down": "#b0bbc6",
        },
        "blush_a": {"calm": 0, "happy": 0.08, "excited": 0.1, "angry": 0.12,
                    "sulky": 0.45, "hurt": 0.12, "jealous": 0.40, "sleepy": 0, "down": 0},
        "shine_a": 0.30,
    },
    "keai": {
        "name": "林小满", "type": "可爱", "kind": "kawaii",
        "motion": 1.15, "period": 0.90,
        "glow": "#6e3e55", "accent": "#efb2c6", "stroke": "#7a4558",
        "ink": "#5a3344", "shine": "#fff8fb", "blush": "#e889a4",
        "faces": {
            "calm": "#f4d6e0", "happy": "#f7dce6", "excited": "#f8dfe8",
            "angry": "#efc5d0", "sulky": "#f0cdd8", "hurt": "#f0d0db",
            "jealous": "#f3c9d6", "sleepy": "#e6c8d2", "down": "#d9b8c4",
        },
        "blush_a": {"calm": 0.38, "happy": 0.62, "excited": 0.58, "angry": 0.55,
                    "sulky": 0.72, "hurt": 0.50, "jealous": 0.72, "sleepy": 0.32, "down": 0.18},
        "shine_a": 0.48, "dot_a": 0.80,
    },
    "nianren": {
        "name": "苏糯", "type": "粘人", "kind": "kawaii",
        "motion": 1.00, "period": 1.00,
        "glow": "#56437a", "accent": "#c9b0ea", "stroke": "#5a4678",
        "ink": "#3a2a55", "shine": "#f6f1fb", "blush": "#c9a0d8",
        "faces": {
            "calm": "#e6dcf3", "happy": "#eee4f8", "excited": "#f0e6fa",
            "angry": "#ddd0e8", "sulky": "#e4d6f0", "hurt": "#e5d6f0",
            "jealous": "#ead8f2", "sleepy": "#d5c8e4", "down": "#c8bad8",
        },
        "blush_a": {"calm": 0.42, "happy": 0.58, "excited": 0.55, "angry": 0.48,
                    "sulky": 0.68, "hurt": 0.55, "jealous": 0.70, "sleepy": 0.30, "down": 0.20},
        "shine_a": 0.50, "dot_a": 0.82,
    },
    "huopo": {
        "name": "夏栀", "type": "活泼", "kind": "kawaii",
        "motion": 1.28, "period": 0.86,
        "glow": "#7a4a2a", "accent": "#f2b783", "stroke": "#8a5530",
        "ink": "#5a3318", "shine": "#fff6ec", "blush": "#f09a7a",
        "faces": {
            "calm": "#f5d3b8", "happy": "#f8dcc4", "excited": "#fbe0c8",
            "angry": "#ebb8a0", "sulky": "#f0c8b0", "hurt": "#f0cbb4",
            "jealous": "#f3c8b4", "sleepy": "#e6c4ac", "down": "#d4b09a",
        },
        "blush_a": {"calm": 0.32, "happy": 0.50, "excited": 0.52, "angry": 0.50,
                    "sulky": 0.60, "hurt": 0.45, "jealous": 0.62, "sleepy": 0.25, "down": 0.14},
        "shine_a": 0.50, "dot_a": 0.85,
    },
    "wenrou": {
        "name": "许暖", "type": "温柔治愈", "kind": "soft",
        "motion": 0.72, "period": 1.14,
        "glow": "#3f5e4a", "accent": "#b3d1b2", "stroke": "#3f5e4a",
        "ink": "#2d4a38", "shine": "#f3faf3", "blush": "#e0c0b0",
        "faces": {
            "calm": "#d8ead8", "happy": "#e0f0e0", "excited": "#e4f2e4",
            "angry": "#cdd8cc", "sulky": "#d4e2d4", "hurt": "#d6e2d6",
            "jealous": "#dbe6d6", "sleepy": "#c8d8c8", "down": "#b8c8b8",
        },
        "blush_a": {"calm": 0.22, "happy": 0.38, "excited": 0.36, "angry": 0.28,
                    "sulky": 0.42, "hurt": 0.36, "jealous": 0.44, "sleepy": 0.16, "down": 0.10},
        "shine_a": 0.40, "dot_a": 0.70,
    },
    "zhixing": {
        "name": "顾书言", "type": "知性文艺", "kind": "line",
        "motion": 0.58, "period": 1.12,
        "glow": "#5e5139", "accent": "#d8c39a", "stroke": "#5a4e38",
        "ink": "#3d3424", "shine": "#f6f0e4", "blush": "#d4b8a8",
        "faces": {
            "calm": "#e8dcc4", "happy": "#eee4ce", "excited": "#f0e6d2",
            "angry": "#ddd3bc", "sulky": "#e4d8c2", "hurt": "#e4d6c0",
            "jealous": "#eadcc8", "sleepy": "#d8ccb4", "down": "#c8bca8",
        },
        "blush_a": {"calm": 0.0, "happy": 0.10, "excited": 0.12, "angry": 0.10,
                    "sulky": 0.28, "hurt": 0.16, "jealous": 0.32, "sleepy": 0.0, "down": 0.0},
        "shine_a": 0.28,
    },
    "chimi": {
        "name": "夜蘅", "type": "痴迷", "kind": "romantic",
        "motion": 0.78, "period": 1.08,
        "glow": "#5e1a2c", "accent": "#d07a8a", "stroke": "#6a2838",
        "ink": "#4a1c28", "shine": "#f6e8ec", "blush": "#b06070",
        "faces": {
            "calm": "#d4b0b6", "happy": "#dcbbc2", "excited": "#e0c0c6",
            "angry": "#c8a4aa", "sulky": "#d0acb4", "hurt": "#d0aeb6",
            "jealous": "#d4a8b2", "sleepy": "#c4a4ac", "down": "#b4949c",
        },
        "blush_a": {"calm": 0.22, "happy": 0.36, "excited": 0.34, "angry": 0.30,
                    "sulky": 0.48, "hurt": 0.40, "jealous": 0.55, "sleepy": 0.18, "down": 0.12},
        "shine_a": 0.32, "dot_a": 0.65,
    },
}

BASE_DUR = {
    "calm": 3.2, "happy": 2.4, "excited": 1.8, "angry": 2.0, "sulky": 2.6,
    "hurt": 3.0, "jealous": 2.5, "sleepy": 3.6, "down": 3.8,
}

SL = 'stroke-linecap="round" stroke-linejoin="round"'


def dur(p, mood):
    return round(min(4.0, max(1.5, BASE_DUR[mood] * p["period"])), 2)


def puff_d(scale=1.0, y=0.0):
    # scale>1 两颊更鼓
    return (
        f"M16 {3.35+y} C{22.7*scale} {3.35+y} {27.7*scale} {8.15+y} {27.95*scale} {14.35+y} "
        f"C{29.85*scale} {16.55+y} {30.05*scale} {21.25+y} {27.35*scale} {24.05+y} "
        f"C{24.85*scale} {28.85+y} 19.35 {29.65+y} 16 {29.65+y} "
        f"C12.65 {29.65+y} {7.15*scale} {28.85+y} {4.65*scale} {24.05+y} "
        f"C{1.95*scale} {21.25+y} {2.15*scale} {16.55+y} {4.05*scale} {14.35+y} "
        f"C{4.3*scale} {8.15+y} {9.3*scale} {3.35+y} 16 {3.35+y} Z"
    )


def glow_puff_d():
    return (
        "M16 2.15 C23.5 2.15 29.15 7.5 29.4 14.3 C31.6 16.7 31.85 22.05 28.7 25.2 "
        "C25.85 30.45 19.7 31.25 16 31.25 C12.3 31.25 6.15 30.45 3.3 25.2 "
        "C0.15 22.05 0.4 16.7 2.6 14.3 C2.85 7.5 8.5 2.15 16 2.15 Z"
    )


def face_base(p, mood, puffed=False):
    face = p["faces"][mood]
    glow, stroke, shine = p["glow"], p["stroke"], p["shine"]
    ba = p["blush_a"].get(mood, 0)
    kind = p["kind"]
    parts = []
    if puffed:
        parts.append(f'  <path d="{glow_puff_d()}" fill="{glow}" opacity="0.26"/>')
        parts.append(f'  <path class="face-shape" d="{puff_d()}" fill="{face}"/>')
        if kind != "line":
            parts.append(f'  <ellipse cx="12.0" cy="10.7" rx="4.8" ry="3.1" fill="{shine}" opacity="{p.get("shine_a",0.45):.2f}"/>')
            parts.append(f'  <circle cx="10.5" cy="10.0" r="1.1" fill="{shine}" opacity="{p.get("dot_a",0.75):.2f}"/>')
        else:
            parts.append(f'  <ellipse cx="12.2" cy="11.0" rx="3.8" ry="2.3" fill="{shine}" opacity="{p.get("shine_a",0.28):.2f}"/>')
        if ba > 0:
            parts.append(f'  <g class="cheeks">')
            parts.append(f'    <ellipse cx="8.2" cy="20.2" rx="3.0" ry="2.1" fill="{p["blush"]}" opacity="{ba:.2f}"/>')
            parts.append(f'    <ellipse cx="23.8" cy="20.2" rx="3.0" ry="2.1" fill="{p["blush"]}" opacity="{ba:.2f}"/>')
            parts.append(f'  </g>')
        parts.append(f'  <path d="{puff_d()}" fill="none" stroke="{stroke}" stroke-width="{"1.2" if kind!="line" else "1.1"}"/>')
    else:
        r = 12.7 if kind != "line" else 12.55
        sw = 1.2 if kind != "line" else 1.1
        parts.append(f'  <circle cx="16" cy="16.7" r="14.15" fill="{glow}" opacity="0.28"/>')
        parts.append(f'  <circle class="face-shape" cx="16" cy="16" r="{r}" fill="{face}"/>')
        if kind != "line":
            parts.append(f'  <ellipse cx="12.0" cy="10.8" rx="5.0" ry="3.3" fill="{shine}" opacity="{p.get("shine_a",0.48):.2f}"/>')
            parts.append(f'  <circle cx="10.6" cy="10.1" r="1.15" fill="{shine}" opacity="{p.get("dot_a",0.8):.2f}"/>')
        else:
            parts.append(f'  <ellipse cx="12.3" cy="11.1" rx="4.0" ry="2.5" fill="{shine}" opacity="{p.get("shine_a",0.30):.2f}"/>')
        if ba > 0:
            parts.append(f'  <g class="cheeks">')
            parts.append(f'    <ellipse cx="9.2" cy="19.4" rx="2.7" ry="1.85" fill="{p["blush"]}" opacity="{ba:.2f}"/>')
            parts.append(f'    <ellipse cx="22.8" cy="19.4" rx="2.7" ry="1.85" fill="{p["blush"]}" opacity="{ba:.2f}"/>')
            parts.append(f'  </g>')
        parts.append(f'  <circle cx="16" cy="16" r="{r}" fill="none" stroke="{stroke}" stroke-width="{sw}"/>')
    return "\n".join(parts)


def features(p, mood):
    ink, acc, shine = p["ink"], p["accent"], p["shine"]
    kind = p["kind"]
    line = kind == "line"
    # 夜蘅眼神略窄；温柔眼睛更圆软
    eye_ry = 2.05 if kind == "romantic" else (2.35 if kind == "soft" else 2.25)
    if mood == "calm":
        if line:
            return f'''  <g class="eyes">
    <g class="eye"><path d="M8.7 14.7h4.8" stroke="{ink}" stroke-width="1.45" {SL}/></g>
    <g class="eye"><path d="M18.5 14.7h4.8" stroke="{ink}" stroke-width="1.45" {SL}/></g>
  </g>
  <path d="M14.3 20.35h3.4" stroke="{ink}" stroke-width="1.35" {SL}/>'''
        return f'''  <g class="eyes">
    <g class="eye"><ellipse cx="11.0" cy="14.2" rx="2.25" ry="{eye_ry}" fill="{ink}"/>
      <circle cx="11.7" cy="13.5" r="0.85" fill="{shine}"/></g>
    <g class="eye"><ellipse cx="21.0" cy="14.2" rx="2.25" ry="{eye_ry}" fill="{ink}"/>
      <circle cx="21.7" cy="13.5" r="0.85" fill="{shine}"/></g>
  </g>
  <path d="M13.5 20.0q2.5 1.85 5.0 0" stroke="{ink}" stroke-width="1.45" {SL}/>'''
    if mood == "happy":
        sw = 1.5 if line else 1.7
        return f'''  <g class="eyes">
    <path d="M8.6 15.35q2.35-2.55 4.7 0" stroke="{ink}" stroke-width="{sw}" {SL}/>
    <path d="M18.7 15.35q2.35-2.55 4.7 0" stroke="{ink}" stroke-width="{sw}" {SL}/>
  </g>
  <path class="smile" d="M{'13.3 19.7q2.7 2.55 5.4 0' if line else '12.4 19.55q3.6 3.35 7.2 0'}" stroke="{ink}" stroke-width="{1.4 if line else 1.6}" {SL}/>'''
    if mood == "excited":
        if line:
            return f'''  <g class="eyes">
    <g class="eye"><ellipse cx="11.05" cy="14.2" rx="2.35" ry="2.55" fill="{ink}"/>
      <circle cx="11.55" cy="13.55" r="0.52" fill="{shine}"/></g>
    <g class="eye"><ellipse cx="20.95" cy="14.2" rx="2.35" ry="2.55" fill="{ink}"/>
      <circle cx="21.45" cy="13.55" r="0.52" fill="{shine}"/></g>
  </g>
  <ellipse cx="16" cy="21.2" rx="2.25" ry="1.95" fill="{ink}"/>
  <g class="star"><path d="M25.15 7.2v2.55M23.85 8.45h2.6" stroke="{acc}" stroke-width="1.25" {SL}/></g>'''
        star = f'  <g class="star"><path d="M25.55 6.7l0.55 1.35 1.4.55-1.4.55-.55 1.35-.55-1.35-1.4-.55 1.4-.55z" fill="{acc}"/></g>'
        spark = "" if kind == "romantic" else (
            f'  <path d="M11 13.95l0.45 1.05 1.1.4-1.1.4-.45 1.05-.45-1.05-1.1-.4 1.1-.4z" fill="{shine}" opacity="0.9"/>\n'
            f'  <path d="M21 13.95l0.45 1.05 1.1.4-1.1.4-.45 1.05-.45-1.05-1.1-.4 1.1-.4z" fill="{shine}" opacity="0.9"/>'
        )
        return f'''  <g class="eyes">
    <g class="eye"><ellipse cx="11.0" cy="13.95" rx="2.55" ry="2.55" fill="{ink}"/>
      <circle cx="11.85" cy="13.05" r="0.85" fill="{shine}"/></g>
    <g class="eye"><ellipse cx="21.0" cy="13.95" rx="2.55" ry="2.55" fill="{ink}"/>
      <circle cx="21.85" cy="13.05" r="0.85" fill="{shine}"/></g>
  </g>
{spark}
  <g class="mouth"><ellipse cx="16" cy="21.35" rx="3.05" ry="2.55" fill="{ink}"/>
    <ellipse cx="16" cy="20.55" rx="1.55" ry="1.15" fill="#4a2a36" opacity="0.45"/></g>
{star}'''
    if mood == "angry":
        steam = f'''  <g class="steam" style="transform-origin: 24px 8px">
    <path d="M22.6 10.2c1.4-1.8 0.2-3.1 1.5-4.8" stroke="{acc}" fill="none" stroke-width="1.15" {SL} opacity="0.9"/>
  </g>'''
        if line:
            return f'''  <path d="M8.15 11.35 13.4 13.45" stroke="{ink}" stroke-width="1.5" {SL}/>
  <path d="M23.85 11.35 18.6 13.45" stroke="{ink}" stroke-width="1.5" {SL}/>
  <g class="eyes">
    <path d="M8.7 15.55 13.5 16.15" stroke="{ink}" stroke-width="1.5" {SL}/>
    <path d="M23.3 15.55 18.5 16.15" stroke="{ink}" stroke-width="1.5" {SL}/>
  </g>
  <path d="M13.7 21.35h4.6" stroke="{ink}" stroke-width="1.4" {SL}/>
{steam}'''
        return f'''  <path d="M7.7 11.15 13.55 13.5" stroke="{ink}" stroke-width="1.65" {SL}/>
  <path d="M24.3 11.15 18.45 13.5" stroke="{ink}" stroke-width="1.65" {SL}/>
  <g class="eyes">
    <ellipse cx="11.05" cy="15.35" rx="2.3" ry="2.05" fill="{ink}"/>
    <ellipse cx="20.95" cy="15.35" rx="2.3" ry="2.05" fill="{ink}"/>
    <circle cx="11.55" cy="14.75" r="0.7" fill="{shine}"/>
    <circle cx="21.45" cy="14.75" r="0.7" fill="{shine}"/>
  </g>
  <path d="M13.1 21.7q2.9-1.7 5.8 0" stroke="{ink}" stroke-width="1.55" {SL}/>
{steam}'''
    if mood == "sulky":
        if line:
            return f'''  <path d="M8.6 12.55h5.0" stroke="{ink}" stroke-width="1.25" {SL}/>
  <path d="M18.4 12.55h5.0" stroke="{ink}" stroke-width="1.25" {SL}/>
  <g class="eyes">
    <path d="M8.9 14.85h4.5" stroke="{ink}" stroke-width="1.4" {SL}/>
    <circle class="pupil" cx="13.15" cy="14.85" r="0.95" fill="{ink}"/>
    <path d="M18.6 14.85h4.5" stroke="{ink}" stroke-width="1.4" {SL}/>
    <circle class="pupil" cx="22.85" cy="14.85" r="0.95" fill="{ink}"/>
  </g>
  <path d="M16.7 20.0c0.15 1.7 2.05 1.7 2.2 0" stroke="{ink}" stroke-width="1.35" {SL}/>'''
        return f'''  <path d="M8.3 12.2h5.1" stroke="{ink}" stroke-width="1.4" {SL}/>
  <path d="M18.6 12.2h5.1" stroke="{ink}" stroke-width="1.4" {SL}/>
  <g class="eyes">
    <g class="eye"><ellipse cx="11.3" cy="14.85" rx="2.15" ry="2.05" fill="{ink}"/>
      <circle class="pupil" cx="12.55" cy="14.55" r="0.85" fill="{shine}"/></g>
    <g class="eye"><ellipse cx="21.4" cy="14.85" rx="2.15" ry="2.05" fill="{ink}"/>
      <circle class="pupil" cx="22.65" cy="14.55" r="0.85" fill="{shine}"/></g>
  </g>
  <path d="M16.5 20.15c0.2 1.9 2.35 1.9 2.55 0" stroke="{ink}" stroke-width="1.5" {SL}/>'''
    if mood == "hurt":
        if line:
            tear = f'  <path class="tear" d="M6.55 17.55c0 2.05 2.35 2.05 2.35 0 0-1.45-1.17-2.75-1.17-2.75S6.55 16.1 6.55 17.55z" fill="{acc}" stroke="{ink}" stroke-width="0.7"/>'
            return f'''  <path d="M8.2 13.35q2.85-2.25 5.3 0.05" stroke="{ink}" stroke-width="1.5" {SL}/>
  <path d="M23.8 13.35q-2.85-2.25-5.3 0.05" stroke="{ink}" stroke-width="1.5" {SL}/>
  <g class="eyes">
    <path d="M8.7 15.7q2.35 1.05 4.7 0" stroke="{ink}" stroke-width="1.45" {SL}/>
    <path d="M18.6 15.7q2.35 1.05 4.7 0" stroke="{ink}" stroke-width="1.45" {SL}/>
  </g>
{tear}
  <path d="M12.7 21.2q1.55 1.85 3.3 0q1.75 1.85 3.3 0" stroke="{ink}" stroke-width="1.45" {SL}/>'''
        tear = f'  <path class="tear" d="M7.05 17.45c0 1.85 2.05 1.85 2.05 0 0-1.25-1.02-2.55-1.02-2.55s-1.03 1.3-1.03 2.55z" fill="#f0f6fb" stroke="{ink}" stroke-width="0.55"/>'
        return f'''  <path d="M8.0 12.7q3.05-2.15 5.7 0.35" stroke="{ink}" stroke-width="1.5" {SL}/>
  <path d="M24.0 12.7q-3.05-2.15-5.7 0.35" stroke="{ink}" stroke-width="1.5" {SL}/>
  <g class="eyes">
    <ellipse cx="11.0" cy="15.15" rx="2.35" ry="2.2" fill="{ink}"/>
    <ellipse cx="21.0" cy="15.15" rx="2.35" ry="2.2" fill="{ink}"/>
    <circle cx="11.7" cy="14.4" r="0.85" fill="{shine}"/>
    <circle cx="21.7" cy="14.4" r="0.85" fill="{shine}"/>
  </g>
{tear}
  <path d="M12.7 21.3q1.6 1.85 3.3 0q1.7 1.85 3.3 0" stroke="{ink}" stroke-width="1.5" {SL}/>'''
    if mood == "jealous":
        heart = f'  <g class="heart"><path d="M26.35 8.35c0-1.05-.85-1.75-1.75-1.75-.6 0-1.15.3-1.45.85-.3-.55-.85-.85-1.45-.85-.9 0-1.75.7-1.75 1.75 0 2.05 3.2 3.85 3.2 3.85s3.2-1.8 3.2-3.85z" fill="{acc}"/></g>'
        if line:
            return f'''  <path d="M8.2 11.15 13.35 13.15" stroke="{ink}" stroke-width="1.45" {SL}/>
  <path d="M18.55 12.55h5.1" stroke="{ink}" stroke-width="1.35" {SL}/>
  <g class="eyes">
    <path d="M8.6 14.85h4.7" stroke="{ink}" stroke-width="1.45" {SL}/>
    <circle class="pupil" cx="13.1" cy="14.85" r="1.05" fill="{ink}"/>
    <path d="M18.6 14.85h4.7" stroke="{ink}" stroke-width="1.45" {SL}/>
    <circle class="pupil" cx="23.1" cy="14.85" r="1.05" fill="{ink}"/>
  </g>
  <path d="M14.55 20.15c0.2 1.85 2.7 1.85 2.9 0" stroke="{ink}" stroke-width="1.5" {SL}/>'''
        return f'''{heart}
  <path d="M8.1 11.55 12.9 13.0" stroke="{ink}" stroke-width="1.45" {SL}/>
  <path d="M18.5 12.35h5.2" stroke="{ink}" stroke-width="1.4" {SL}/>
  <g class="eyes">
    <g class="eye"><ellipse cx="11.15" cy="14.85" rx="2.2" ry="2.1" fill="{ink}"/>
      <circle class="pupil" cx="12.4" cy="14.55" r="0.85" fill="{shine}"/></g>
    <g class="eye"><ellipse cx="21.2" cy="14.85" rx="2.2" ry="2.1" fill="{ink}"/>
      <circle class="pupil" cx="22.45" cy="14.55" r="0.85" fill="{shine}"/></g>
  </g>
  <path d="M14.7 20.55h2.6" stroke="{ink}" stroke-width="1.7" {SL}/>'''
    if mood == "sleepy":
        if line:
            return f'''  <g class="eyes">
    <path d="M8.55 14.35q2.4 2.0 4.8 0" stroke="{ink}" stroke-width="1.45" {SL}/>
    <path d="M18.65 14.35q2.4 2.0 4.8 0" stroke="{ink}" stroke-width="1.45" {SL}/>
  </g>
  <g class="yawn"><ellipse cx="16" cy="20.85" rx="3.15" ry="3.85" fill="{ink}"/>
    <ellipse cx="16" cy="19.85" rx="1.7" ry="1.55" fill="#1c2732" opacity="0.55"/></g>'''
        return f'''  <g class="eyes">
    <path d="M8.05 14.15q2.9 2.55 5.8 0" stroke="{ink}" stroke-width="1.65" {SL}/>
    <path d="M18.15 14.15q2.9 2.55 5.8 0" stroke="{ink}" stroke-width="1.65" {SL}/>
  </g>
  <g class="yawn"><ellipse cx="16" cy="21.0" rx="3.55" ry="4.15" fill="{ink}"/>
    <ellipse cx="16" cy="20.0" rx="1.9" ry="1.7" fill="#4a2a36" opacity="0.5"/></g>'''
    if mood == "down":
        if line:
            return f'''  <path d="M8.55 13.35h4.7" stroke="{ink}" stroke-width="1.25" {SL}/>
  <path d="M18.75 13.35h4.7" stroke="{ink}" stroke-width="1.25" {SL}/>
  <g class="eyes">
    <path d="M8.7 16.15q2.35 1.35 4.7 0" stroke="{ink}" stroke-width="1.4" {SL}/>
    <path d="M18.6 16.15q2.35 1.35 4.7 0" stroke="{ink}" stroke-width="1.4" {SL}/>
  </g>
  <path d="M14.35 22.15h3.3" stroke="{ink}" stroke-width="1.3" {SL}/>'''
        return f'''  <path d="M8.3 13.15h5.2" stroke="{ink}" stroke-width="1.35" {SL}/>
  <path d="M18.5 13.15h5.2" stroke="{ink}" stroke-width="1.35" {SL}/>
  <g class="eyes">
    <ellipse cx="11.05" cy="16.35" rx="2.2" ry="1.7" fill="{ink}"/>
    <ellipse cx="20.95" cy="16.35" rx="2.2" ry="1.7" fill="{ink}"/>
    <circle cx="11.35" cy="16.85" r="0.55" fill="{shine}" opacity="0.45"/>
    <circle cx="21.25" cy="16.85" r="0.55" fill="{shine}" opacity="0.45"/>
  </g>
  <path d="M13.9 22.35q2.1-0.9 4.2 0" stroke="{ink}" stroke-width="1.45" {SL}/>'''
    raise KeyError(mood)


def anim_css(mood, m, d):
    # m: motion amplitude, d: duration seconds
    reduce = """
    @media (prefers-reduced-motion: reduce) {
      .movable, .movable * { animation: none !important; }
    }"""
    common = f"""
    .eye, .cheeks, .pupil, .star, .steam, .tear, .heart, .yawn, .mouth {{
      transform-box: fill-box; transform-origin: center;
    }}
    .root {{ transform-box: fill-box; transform-origin: 16px 22px; }}
    """
    if mood == "calm":
        rules = f"""
    .eye {{ animation: blink {d}s ease-in-out infinite; }}
    @keyframes blink {{
      0%, 68%, 78%, 100% {{ transform: scaleY(1); }}
      73% {{ transform: scaleY(0.08); }}
    }}
    .root {{ animation: breathe {d}s ease-in-out infinite; }}
    @keyframes breathe {{
      0%, 100% {{ transform: scale(1); }}
      50% {{ transform: scale({1 + 0.012 * m:.4f}); }}
    }}"""
    elif mood == "happy":
        deg = 2.4 * m
        rules = f"""
    .root {{ animation: sway {d}s ease-in-out infinite; }}
    @keyframes sway {{
      0%, 100% {{ transform: rotate({-deg:.2f}deg); }}
      50% {{ transform: rotate({deg:.2f}deg); }}
    }}
    .eyes {{ animation: squint {d}s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }}
    @keyframes squint {{
      0%, 100% {{ transform: scaleY(1); }}
      50% {{ transform: scaleY(0.92); }}
    }}"""
    elif mood == "excited":
        hop = 2.8 * m
        rules = f"""
    .root {{ animation: hop {d}s ease-in-out infinite; }}
    @keyframes hop {{
      0%, 55%, 100% {{ transform: translateY(0); }}
      28% {{ transform: translateY({-hop:.2f}px); }}
    }}
    .star {{ animation: twinkle {d}s ease-in-out infinite; }}
    @keyframes twinkle {{
      0%, 100% {{ opacity: 0.4; transform: scale(0.85) rotate(0deg); }}
      40% {{ opacity: 1; transform: scale(1.2) rotate(18deg); }}
      60% {{ opacity: 0.55; transform: scale(0.95) rotate(8deg); }}
    }}"""
    elif mood == "angry":
        sh = 0.55 * m
        rules = f"""
    .root {{ animation: shake {d}s ease-in-out infinite; }}
    @keyframes shake {{
      0%, 100% {{ transform: translateX(0); }}
      15% {{ transform: translateX({-sh:.2f}px); }}
      30% {{ transform: translateX({sh:.2f}px); }}
      45% {{ transform: translateX({-sh*0.7:.2f}px); }}
      60% {{ transform: translateX({sh*0.7:.2f}px); }}
      75% {{ transform: translateX(0); }}
    }}
    .steam {{ animation: steam {d}s ease-out infinite; }}
    @keyframes steam {{
      0% {{ opacity: 0; transform: translateY(0) scale(0.7); }}
      25% {{ opacity: 0.9; }}
      100% {{ opacity: 0; transform: translateY(-5.5px) scale(1.15); }}
    }}"""
    elif mood == "sulky":
        puff = 1 + 0.16 * m
        glance = 1.15 * m
        rules = f"""
    .cheeks {{ animation: puff {d}s ease-in-out infinite; }}
    @keyframes puff {{
      0%, 100% {{ transform: scale(1); }}
      45% {{ transform: scale({puff:.3f}); }}
    }}
    .pupil {{ animation: glance {d}s ease-in-out infinite; }}
    @keyframes glance {{
      0%, 100% {{ transform: translateX(0); }}
      30%, 60% {{ transform: translateX({glance:.2f}px); }}
    }}"""
    elif mood == "hurt":
        drop = 3.6 * (0.7 + 0.3 * m)
        rules = f"""
    .tear {{ animation: teardrop {d}s ease-in infinite; }}
    @keyframes teardrop {{
      0% {{ opacity: 0; transform: translateY(-1.2px); }}
      12% {{ opacity: 1; transform: translateY(0); }}
      72% {{ opacity: 1; transform: translateY({drop:.2f}px); }}
      88%, 100% {{ opacity: 0; transform: translateY({drop+1.6:.2f}px); }}
    }}"""
    elif mood == "jealous":
        peek = 1.15 * m
        rules = f"""
    .pupil {{ animation: peek {d}s ease-in-out infinite; }}
    @keyframes peek {{
      0%, 100% {{ transform: translateX({peek:.2f}px); }}
      50% {{ transform: translateX({-peek:.2f}px); }}
    }}
    .heart {{ animation: heartbit {d}s ease-in-out infinite; }}
    @keyframes heartbit {{
      0%, 42%, 100% {{ opacity: 0.4; transform: scale(0.9); }}
      55% {{ opacity: 1; transform: scale(1.22); }}
      70% {{ opacity: 0.55; transform: scale(1); }}
    }}"""
    elif mood == "sleepy":
        nod = 5.2 * m
        rules = f"""
    .root {{ animation: nod {d}s ease-in-out infinite; transform-origin: 16px 26px; }}
    @keyframes nod {{
      0%, 100% {{ transform: rotate(0deg); }}
      42% {{ transform: rotate({nod:.2f}deg); }}
      70% {{ transform: rotate({nod*0.2:.2f}deg); }}
    }}
    .yawn {{ animation: yawn {d}s ease-in-out infinite; }}
    @keyframes yawn {{
      0%, 100% {{ transform: scale(1, 0.9); }}
      45% {{ transform: scale(1.05, 1.14); }}
    }}"""
    else:  # down
        sink = 1.25 * m
        rules = f"""
    .root {{ animation: sink {d}s ease-in-out infinite; }}
    @keyframes sink {{
      0%, 100% {{ transform: translateY(0) scale(1); }}
      50% {{ transform: translateY({sink:.2f}px) scale(0.985); }}
    }}"""
    return "    " + common.strip() + "\n" + rules + reduce


def svg_wrap(inner, title, css=None):
    style = ""
    if css:
        style = f"  <style>\n{css}\n  </style>\n"
    root_open = '  <g class="root movable">\n' if css else ""
    root_close = "\n  </g>" if css else ""
    # indent inner if wrapping
    body = inner
    if css:
        body = "\n".join(("    " + ln if ln.strip() else ln) for ln in inner.splitlines())
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"'
        ' width="32" height="32" fill="none" overflow="visible">\n'
        f"  <title>{title}</title>\n"
        f"{style}{root_open}{body}{root_close}\n"
        "</svg>\n"
    )


def build_one(pid, p, mood, label, animated):
    puffed = mood == "sulky"
    inner = face_base(p, mood, puffed=puffed) + "\n" + features(p, mood)
    if not animated:
        # 静态版去掉仅动画用的蒸汽，保留其余
        lines = [ln for ln in inner.splitlines() if 'class="steam"' not in ln and "class=\"steam\"" not in ln]
        # 上面太粗，蒸汽是一个 g 块。静态保留一小缕浅淡蒸汽也可，但先前静态没有。去掉整个 steam 组：
        inner = strip_group(inner, "steam")
        return svg_wrap(inner, label, css=None)
    css = anim_css(mood, p["motion"], dur(p, mood))
    return svg_wrap(inner, label, css=css)


def strip_group(svg_inner, cls):
    out, skip, depth = [], False, 0
    for ln in svg_inner.splitlines():
        if f'class="{cls}"' in ln and "<g" in ln:
            skip, depth = True, ln.count("<g") - ln.count("</g>")
            if depth <= 0:
                skip = False
            continue
        if skip:
            depth += ln.count("<g") - ln.count("</g>")
            if depth <= 0:
                skip = False
            continue
        out.append(ln)
    return "\n".join(out)


def write_all():
    n = 0
    for pid, p in PERSONAS.items():
        d_design = ROOT / pid
        d_assets = ASSETS / pid
        d_design.mkdir(parents=True, exist_ok=True)
        d_assets.mkdir(parents=True, exist_ok=True)
        for mood, label in MOODS:
            static = build_one(pid, p, mood, label, False)
            anim = build_one(pid, p, mood, label, True)
            for dest in (d_design, d_assets):
                (dest / f"{mood}.svg").write_text(static, encoding="utf-8")
                (dest / f"{mood}-anim.svg").write_text(anim, encoding="utf-8")
            n += 2
    print(f"wrote {n} svg files × 2 locations")


if __name__ == "__main__":
    write_all()
