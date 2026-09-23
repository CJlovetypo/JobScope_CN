"""Skill-local entry; shared extraction with isolated output validation."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    skill_root = Path(__file__).resolve().parents[1]
    api = runpy.run_path(str(skill_root.parents[2] / 'shared/job-search-core/scripts/extract_resume.py'))
    api['main'](skill_root=skill_root)
