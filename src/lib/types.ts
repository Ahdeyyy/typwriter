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

export type Range = {
    start: number;
    end: number;
}

export type DiagnosticResponse = {
    range: Range;
    severity: Severity;
    message: string;
    hints: string[];
}