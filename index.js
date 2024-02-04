const inquirerDirectory = require("inquirer-directory");
const inquirer = import("inquirer");
const fs = require("fs");

const getInquirer = async () => {
  const result = (await inquirer).default;
  result.registerPrompt("directory", inquirerDirectory);
  return result;
};

const tracker = {
  start: Date.now(),
  audio: { downloaded: 0, total: Infinity, speed: 0 },
  video: { downloaded: 0, total: Infinity, speed: 0 },
  merged: { frame: 0, speed: "0x", fps: 0 },
};

const estimateTimeLeft = (startedAt, downloaded, total) => {
  const elapsedTime = (Date.now() - startedAt) / 1000;

  const downloadSpeed = downloaded / elapsedTime;

  const remainingBytes = total - downloaded;
  const estimatedTimeLeftInSeconds = remainingBytes / downloadSpeed;

  const hours = Math.floor(estimatedTimeLeftInSeconds / 3600);
  const minutes = Math.floor((estimatedTimeLeftInSeconds % 3600) / 60);
  const seconds = Math.floor(estimatedTimeLeftInSeconds % 60);

  let formattedTime = "";
  if (hours > 0) {
    formattedTime += `${hours} hours `;
  }
  if (minutes > 0) {
    formattedTime += `${minutes} mins `;
  }
  if (estimatedTimeLeftInSeconds < 60) {
    formattedTime += `${seconds} seconds`;
  }

  return formattedTime.trim();
};

const getAnimatedLoading = (percentage) => {
  const blocks = 20;
  const progress = Math.round((blocks * percentage) / 100);
  const empty = blocks - progress;
  const progressBar = "█".repeat(progress) + "░".repeat(empty);
  return `[${progressBar}] ${percentage.toFixed(2)}%`;
};

const showFancyProgress = () => {
  console.clear();
  const toMB = (i) => (i / 1024 / 1024).toFixed(2);

  console.log(
    `Audio  | ${getAnimatedLoading(
      (tracker.audio.downloaded / tracker.audio.total) * 100
    )}`
  );
  const audioTimeLeft = estimateTimeLeft(
    tracker.start,
    tracker.audio.downloaded,
    tracker.audio.total
  );
  console.log(`Estimated time left for audio: ${audioTimeLeft}`);
  console.log(
    ` (${toMB(tracker.audio.downloaded)}MB of ${toMB(tracker.audio.total)}MB)\n`
  );

  console.log(
    `Video  | ${getAnimatedLoading(
      (tracker.video.downloaded / tracker.video.total) * 100
    )}`
  );

  const videoTimeLeft = estimateTimeLeft(
    tracker.start,
    tracker.video.downloaded,
    tracker.video.total
  );
  console.log(`Estimated time left for video: ${videoTimeLeft}`);
  console.log(
    ` (${toMB(tracker.video.downloaded)}MB of ${toMB(tracker.video.total)}MB)\n`
  );

  console.log(`Merged | processing frame ${tracker.merged.frame} `);
  console.log(`(at ${tracker.merged.fps} fps => ${tracker.merged.speed})\n`);

  console.log(
    `running for: ${((Date.now() - tracker.start) / 1000 / 60).toFixed(
      2
    )} Minutes.`
  );
};

const downloadAndEncode = async () => {
  let progressbarHandle = null;

  const basePath = require("os").homedir();
  const inquirer = await getInquirer();
  const ytdl = require("ytdl-core");
  const path = require("path");
  const cp = require("child_process");
  const ffmpeg = require("ffmpeg-static");

  const { youtubeUrl } = await inquirer.prompt([
    {
      type: "input",
      name: "youtubeUrl",
      message: "Enter the YouTube video URL:",
    },
  ]);

  const videoInfo = await ytdl.getInfo(youtubeUrl);
  const { outputDir, format } = await inquirer.prompt([
    {
      type: "directory",
      name: "outputDir",
      message: "Choose the output directory:",
      basePath,
    },
    {
      type: "list",
      name: "format",
      message: "Select video format:",
      choices: ["mp4", "mkv", "webm"],
    },
  ]);

  const videoFormats = videoInfo.formats
    .filter((f) => !!f.videoCodec && f.container.includes(format))
    .map((format) => ({
      name: `${format.qualityLabel} - ${format.container}`,
      value: format.itag,
    }))
    .filter(
      (f, index, self) => index === self.findIndex((t) => t.name === f.name)
    );

  const { quality } = await inquirer.prompt([
    {
      type: "list",
      name: "quality",
      message: "Select video resolution:",
      choices: videoFormats,
    },
  ]);

  let videoTitle = videoInfo.videoDetails.title.split(" ").join("_");

  const audio = ytdl(youtubeUrl, { quality: "highestaudio" }).on(
    "progress",
    (_, downloaded, total) => {
      tracker.audio = { downloaded, total };
      showFancyProgress();
    }
  );

  const video = ytdl(youtubeUrl, { quality: quality }).on(
    "progress",
    (_, downloaded, total) => {
      tracker.video = { downloaded, total };
      showFancyProgress();
    }
  );

  let outputFilePath = path.join(
    `${basePath}/` + outputDir,
    `${videoTitle}.${format}`
  );

  let fileIndex = 1;
  while (fs.existsSync(outputFilePath)) {
    videoTitle = `${videoInfo.videoDetails.title
      .split(" ")
      .join("_")}_${fileIndex}`;
    outputFilePath = path.join(
      `${basePath}/` + outputDir,
      `${videoTitle}.${format}`
    );
    fileIndex++;
  }

  const ffmpegProcess = cp.spawn(
    ffmpeg,
    [
      "-loglevel",
      "8",
      "-hide_banner",
      "-progress",
      "pipe:3",
      "-i",
      "pipe:4",
      "-i",
      "pipe:5",
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-c:v",
      "copy",
      outputFilePath,
    ],
    {
      windowsHide: true,
      stdio: ["inherit", "inherit", "inherit", "pipe", "pipe", "pipe"],
    }
  );

  ffmpegProcess.on("close", () => {
    console.log("done");
    process.stdout.write("\n\n\n\n");
    clearInterval(progressbarHandle);
    progressbarHandle = null;
  });
  ffmpegProcess.stdio[3].on("data", (chunk) => {
    const lines = chunk.toString().trim().split("\n");
    const args = {};
    for (const l of lines) {
      const [key, value] = l.split("=");
      args[key.trim()] = value.trim();
    }
    tracker.merged = args;
    showFancyProgress();
  });

  audio.pipe(ffmpegProcess.stdio[4]);
  video.pipe(ffmpegProcess.stdio[5]);
};

if (require.main === module) {
  console.clear();
  downloadAndEncode();
}
