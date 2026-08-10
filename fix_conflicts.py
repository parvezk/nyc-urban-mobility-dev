import re

with open("components/StoryTimeline.tsx", "r") as f:
    content = f.read()

# Fix first conflict (button)
content = re.sub(
    r"<<<<<<< HEAD\n\s*aria-label=\{isPlaying \? \"Pause timeline\" : \"Play timeline\"\}\n\s*title=\{isPlaying \? \"Pause timeline\" : \"Play timeline\"\}\n\s*className=\"w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center border border-slate-600 transition-all shadow-md active:scale-95 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none\"\n=======\n\s*className=\"w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center border border-slate-600 transition-all shadow-md active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500\"\n\s*aria-label=\{isPlaying \? \"Pause timeline\" : \"Play timeline\"\}\n\s*title=\{isPlaying \? \"Pause timeline\" : \"Play timeline\"\}\n>>>>>>> origin/master",
    'aria-label={isPlaying ? "Pause timeline" : "Play timeline"}\n            title={isPlaying ? "Pause timeline" : "Play timeline"}\n            className="w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center border border-slate-600 transition-all shadow-md active:scale-95 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none"',
    content
)

# Fix second conflict (input range)
content = re.sub(
    r"<<<<<<< HEAD\n\s*aria-label=\"Timeline scrubber\"\n\s*className=\"w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-300 hover:accent-slate-200 transition-all focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none\"\n=======\n\s*className=\"w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500\"\n\s*aria-label=\"Timeline scrubber\"\n>>>>>>> origin/master",
    'aria-label="Timeline scrubber"\n            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-300 hover:accent-slate-200 transition-all focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none"',
    content
)

with open("components/StoryTimeline.tsx", "w") as f:
    f.write(content)
