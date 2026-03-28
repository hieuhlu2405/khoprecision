import * as xlsx from 'xlsx';

/**
 * Xuất dữ liệu ra file Excel (.xlsx)
 * @param data Array chứa các object dữ liệu cần xuất
 * @param filename Tên file mong muốn (không cần bao gồm đuôi .xlsx)
 * @param sheetName Tên của sheet trong file Excel (mặc định 'Sheet1')
 */
export function exportToExcel<T>(data: T[], filename: string, sheetName: string = 'Sheet1') {
  if (!data || data.length === 0) {
    console.warn("Không có dữ liệu để xuất Excel.");
    return;
  }

  // 1. Tạo 1 sheet từ dữ liệu JSON (Array of Objects)
  const worksheet = xlsx.utils.json_to_sheet(data);

  // 2. Tạo 1 định dạng workbook mới và gắn sheet vào
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Auto-size columns cơ bản (tính độ rộng tối thiểu)
  const colWidths = Object.keys(data[0] as object).map(key => ({
    wch: Math.max(key.length + 5, 12)
  }));
  worksheet['!cols'] = colWidths;

  // 3. Kích hoạt việc tải xuống file
  xlsx.writeFile(workbook, `${filename}.xlsx`);
}

/**
 * Đọc dữ liệu từ file Excel
 * @param file Đối tượng File từ input type="file"
 * @returns Promise chứa mảng các object dữ liệu
 */
export async function readExcel(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = xlsx.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = xlsx.utils.sheet_to_json(worksheet);
        resolve(json);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
