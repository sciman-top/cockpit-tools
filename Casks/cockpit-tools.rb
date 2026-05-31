cask "cockpit-tools" do
  version "0.24.9"
  sha256 "551299e12f0fcbdd5c23701a8c1c37ce65de9c4957e78e94a738c9b488d9c6f3"

  url "https://github.com/sciman-top/cockpit-tools-local/releases/download/v#{version}/Cockpit.Tools_#{version}_universal.dmg",
      verified: "github.com/sciman-top/cockpit-tools-local/"
  name "Cockpit Tools Local"
  desc "Self-use account manager for AI IDEs with local Codex safeguards"
  homepage "https://github.com/sciman-top/cockpit-tools-local"

  auto_updates true

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Cockpit Tools.app"],
                   sudo: true
  end

  app "Cockpit Tools.app"

  zap trash: [
    "~/Library/Application Support/com.sciman.cockpit-tools-local",
    "~/Library/Caches/com.sciman.cockpit-tools-local",
    "~/Library/Preferences/com.sciman.cockpit-tools-local.plist",
    "~/Library/Saved Application State/com.sciman.cockpit-tools-local.savedState",
  ]

  caveats <<~EOS
    The app is automatically quarantined by macOS. A postflight hook has been added to remove this quarantine.
    If you still encounter the "App is damaged" error, please run:
      sudo xattr -rd com.apple.quarantine "/Applications/Cockpit Tools.app"
  EOS
end
