/**
 * #[derive(Serialize, Clone, Debug)]
pub struct Range<T> {
    pub start: T,
    pub end: T,
}

#[derive(Serialize, Clone, Debug)]
pub enum TypstSeverity {
    Error,
    Warning,
}

#[derive(Serialize, Clone, Debug)]
pub struct TypstSourceDiagnostic {
    pub range: Range<usize>,
    pub severity: TypstSeverity,
    pub message: String,
    pub hints: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct RenderResponse {
    image: String,
    width: u32,
    height: u32,
}
 * 
 */

export type RenderResponse = {
    image: string;
    width: number;
    height: number;
}

export type Severity = "Warning" | "Error"

export type Location = {
    line: number;
    column: number;
    end_line: number;
    end_column: number;
}

export type DiagnosticResponse = {
    location: Location;
    severity: Severity;
    message: string;
    hints: string[];
}

/**
 * Interfaces corresponding to the Rust structs FileJump and PositionJump.
 * In Rust, PathBuf and usize/f64 map directly to string and number in TypeScript.
 */

// Corresponds to FileJump struct in Rust
export interface FileJump {
    /** The path of the file to jump to. (Rust PathBuf -> string) */
    file: string;
    /** The byte position within the file. (Rust usize -> number) */
    position: number;
}

// Corresponds to PositionJump struct in Rust
export interface PositionJump {
    /** The page number in the document preview. (Rust usize -> number) */
    page: number;
    /** The x-coordinate on the page. (Rust f64 -> number) */
    x: number;
    /** The y-coordinate on the page. (Rust f64 -> number) */
    y: number;
}

/**
 * Union type corresponding to the externally tagged DocumentClickResponseType enum.
 *
 * Rust definition: #[serde(tag = "type")]
 * This means every serialized JSON object will have a 'type' field that
 * determines which variant (and thus, which interface) it is.
 */

// 1. FileJump variant: Merges the tag with the FileJump interface properties.
export type DocumentClickResponseFileJump = {
    type: "FileJump";
} & FileJump;

// 2. PositionJump variant: Merges the tag with the PositionJump interface properties.
export type DocumentClickResponsePositionJump = {
    type: "PositionJump";
} & PositionJump;

// 3. UrlJump variant: We assume the String value is serialized to a field named 'url'
// (as is often the pattern when annotating the variant in Rust, e.g., using content = "url").
export interface DocumentClickResponseUrlJump {
    type: "UrlJump";
    url: string;
}

// 4. NoJump variant: A unit variant only contains the tag.
export interface DocumentClickResponseNoJump {
    type: "NoJump";
}

/**
 * The final union of all possible response types.
 * This allows for **type narrowing** in TypeScript based on the 'type' field.
 *
 * Example usage:
 * function handleResponse(response: DocumentClickResponseType) {
 * if (response.type === "PositionJump") {
 * // TypeScript knows 'response' has 'page', 'x', and 'y' fields here.
 * console.log(`Jumping to page ${response.page}`);
 * }
 * }
 */
export type DocumentClickResponseType =
    | DocumentClickResponseFileJump
    | DocumentClickResponsePositionJump
    | DocumentClickResponseUrlJump
    | DocumentClickResponseNoJump;

