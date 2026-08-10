import re

with open("components/StoryTimeline.tsx", "r") as f:
    content = f.read()

# Fix first conflict (button)
content = re.sub(
    r"\naria-label=\{isPlaying \? \"Pause timeline\" : \"Play timeline\"\}",
    '\n            aria-label={isPlaying ? "Pause timeline" : "Play timeline"}',
    content
)

# Fix second conflict (input range)
content = re.sub(
    r"\naria-label=\"Timeline scrubber\"",
    '\n            aria-label="Timeline scrubber"',
    content
)

with open("components/StoryTimeline.tsx", "w") as f:
    f.write(content)
