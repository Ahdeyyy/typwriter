pub fn pixel_to_point(x: f64, scale: f32) -> f64 {
    // Convert image pixels back to document points
    // Since we render at scale factor, we need to divide by scale to get document coordinates
    x / scale as f64
}

pub fn byte_position_to_char_position(str: &str, byte_position: usize) -> usize {
    str.char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i < byte_position)
        .count()
}

pub fn char_to_byte_position(str: &str, char_position: usize) -> usize {
    str.char_indices()
        .map(|(i, _)| i)
        .nth(char_position)
        .unwrap_or(str.len())
}
