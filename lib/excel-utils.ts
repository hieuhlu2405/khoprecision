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

/**
 * Tiêm dữ liệu vào một file mẫu Excel có sẵn
 * @param templateUrl Đường dẫn đến file mẫu (ví dụ: '/templates/mau.xlsx')
 * @param cellData Map các ô cụ thể cần điền (VD: { 'C2': 'Tên Cty', 'C7': 'Khách hàng' })
 * @param tableData Mảng các mảng (Array of Arrays) cho phần bảng kê chi tiết
 * @param tableOrigin Ô bắt đầu của bảng kê (VD: 'A11')
 * @param filename Tên file tải về (không kèm đuôi)
 */
export async function exportWithTemplate(
  templateUrl: string, 
  cellData: Record<string, string | number | null>, 
  tableData: any[][], 
  tableOrigin: string,
  filename: string
) {
  try {
    const response = await fetch(templateUrl);
    if (!response.ok) throw new Error("Không thể tải file mẫu.");
    const arrayBuffer = await response.arrayBuffer();
    
    // Đọc workbook
    const workbook = xlsx.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // 1. Điền các ô đơn lẻ (Header/Footer)
    Object.entries(cellData).forEach(([cell, value]) => {
      if (value !== null && value !== undefined) {
        xlsx.utils.sheet_add_aoa(worksheet, [[value]], { origin: cell });
      }
    });

    // 2. Điền bảng dữ liệu chi tiết
    if (tableData.length > 0) {
      xlsx.utils.sheet_add_aoa(worksheet, tableData, { origin: tableOrigin });
    }

    // 3. Xuất file
    xlsx.writeFile(workbook, `${filename}.xlsx`);
  } catch (error) {
    console.error("Lỗi khi xuất template Excel:", error);
    throw error;
  }
}
