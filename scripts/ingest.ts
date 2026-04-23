import fs from 'fs/promises';
import path from 'path';

const TARGET_DIR = process.argv[2];
const API_URL = "http://localhost:3000/api/memory";

if (!TARGET_DIR) {
  console.log("Cú pháp sử dụng: npx tsx scripts/ingest.ts <đường_dẫn_đến_thư_mục_cũ>");
  process.exit(1);
}

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'out', 'public', 'assets', '.vscode'];
const ALLOWED_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.md', '.json'];
const MAX_FILE_SIZE = 50000; // 50KB

async function walkAndIngest(dir: string) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          await walkAndIngest(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        
        if (ALLOWED_EXTS.includes(ext)) {
          const stats = await fs.stat(fullPath);
          if (stats.size > MAX_FILE_SIZE) {
            console.log(`⏱ Bỏ qua (File quá lớn, >50KB): ${fullPath}`);
            continue;
          }

          console.log(`Đang đọc: ${fullPath} ...`);
          const content = await fs.readFile(fullPath, 'utf-8');

          try {
            const response = await fetch(API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "pattern",
                content: `File: ${entry.name}\n\n${content}`,
                tags: [ext.replace('.', ''), 'legacy_import'],
                project: path.basename(path.resolve(TARGET_DIR))
              })
            });

            if (response.ok) {
              console.log(`  ✅ Đã phân tích và nạp vào Vector Memory`);
            } else {
              console.error(`  ❌ Lỗi API: ${response.status} ${response.statusText}`);
            }
          } catch (err: any) {
            console.error(`  ❌ Lỗi kết nối đến server: ${err.message}`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Lỗi không thể đọc thư mục ${dir}:`, error);
  }
}

console.log(`🚀 Bắt đầu quét thư mục: ${path.resolve(TARGET_DIR)}`);
walkAndIngest(path.resolve(TARGET_DIR)).then(() => {
  console.log("🎉 Hoàn tất quá trình nạp dữ liệu!");
});
