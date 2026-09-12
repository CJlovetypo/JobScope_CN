"""Extract user-provided resume text without sending it to a network service."""
import argparse,json,zipfile
from pathlib import Path
from xml.etree import ElementTree

def extract(p):
 suffix=p.suffix.lower()
 if suffix in ('.txt','.md'):return p.read_text(encoding='utf-8-sig')
 if suffix=='.docx':
  with zipfile.ZipFile(p) as archive:root=ElementTree.fromstring(archive.read('word/document.xml'))
  ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
  return '\n'.join(''.join(t.text or '' for t in paragraph.findall('.//w:t',ns)) for paragraph in root.findall('.//w:p',ns))
 if suffix=='.pdf':
  try:from pypdf import PdfReader
  except ImportError:raise RuntimeError('读取 PDF 需要 Python pypdf；可使用 Codex 附带的 Python 运行时或先提供简历文本。')
  return '\n\n'.join(page.extract_text() or '' for page in PdfReader(p).pages)
 raise ValueError('第一版支持 PDF、DOCX、Markdown/TXT；此文件格式请先转换为可读文本。')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('input');parser.add_argument('--out',required=True);args=parser.parse_args()
 p=Path(args.input).resolve();out=Path(args.out).resolve();skill=Path(__file__).resolve().parents[1]
 if not out.is_relative_to(skill):raise ValueError('产物必须位于本 skill 文件夹内')
 text=extract(p).strip()
 if len(text)<40:raise ValueError('未提取到足够简历文字，可能是扫描件；请用户补充可读文本，不猜测内容。')
 out.parent.mkdir(parents=True,exist_ok=True);out.write_text(text+'\n',encoding='utf-8')
 print(json.dumps({'output':str(out),'characters':len(text)},ensure_ascii=False))
if __name__=='__main__':main()
